# -*- coding: utf-8 -*-
"""
WO-61 — a ponte MetaTrader 5: a plataforma lê o mercado do terminal da corretora.

Um servidor HTTP pequeno, só biblioteca padrão + MetaTrader5, que fala com o terminal MT5 JÁ
ABERTO E LOGADO nesta máquina (IPC local) e responde JSON para a plataforma (Next.js) na mesma
máquina. Escuta APENAS em 127.0.0.1 — nunca sai da máquina.

A ponte NUNCA recebe login, senha nem servidor: `mt5.initialize()` sem argumentos liga-se ao
terminal que o operador abriu. O número da conta não aparece em resposta nem em log.

Rotas (todas GET, JSON):
  /saude                                  → o terminal está aberto? logado?
  /cotacao?ticker=PETR4                   → último tick do papel
  /cadeia?ticker=PETR4&soMensal=0&maxExpiries=8&esperaMs=2500[&bandaPct=12]
                                          → séries vigentes dos vencimentos pedidos, com bid/ask/
                                            último/tick; `esperaMs` é o orçamento para completar
                                            o cache diário (negócios, último negócio) no pedido;
                                            `bandaPct` recorta |K/S − 1| (a varredura usa ±5 %:
                                            seleciona ~40 séries por papel em vez de 500)
  /historico?ticker=PETR4&range=1y        → candles diários (3mo|6mo|1y|2y|5y)
  /ticks?serie=PETRI499&data=2026-09-17   → negócios do dia de UMA série
  /macro?simbolos=IBOV,ISP$,DOL$&range=1y → último tick + fechamentos diários de índices e
                                            contratos contínuos da BMF (WO-62)
  /curva-di                               → os contratos DI1 vigentes: taxa (último), bid/ask,
                                            vencimento e fechamentos diários (WO-62)

Uso:  python scripts/mt5-ponte.py            (porta 3200; PONTE_MT5_PORTA muda)
      npm run ponte                          (o mesmo)

Fatos medidos em 17/09/2026 (ver WO-61-PROMPT.md §3) que moldam o código:
  - os instantes do MT5 vêm no fuso do SERVIDOR (Brasília) embalados como epoch "UTC": lê-se
    sem converter; "agora" no relógio do servidor é time.time() − 3 h;
  - o catálogo inclui séries vencidas desde 2022 e instrumentos de exercício (sufixo E, cuja
    base é a própria opção): filtra-se por base == papel e vencimento ≥ agora;
  - session_deals/session_volume vêm zerados para opções: negócios e quantidade do dia saem do
    candle D1 da série (tick_volume = negócios, real_volume = quantidade);
  - um símbolo recém-selecionado leva 1–3 s para receber o primeiro tick; símbolos fora do
    Market Watch vêm com last/bid/ask zerados em `symbols_get`, e o Market Watch aceita no
    máximo 5.000 símbolos.
"""
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

try:
    import MetaTrader5 as mt5
except ImportError:  # pragma: no cover
    print("Biblioteca MetaTrader5 ausente: python -m pip install MetaTrader5")
    sys.exit(2)

VERSAO_PONTE = "1.2.0"
HOST = "127.0.0.1"
PORTA = int(os.environ.get("PONTE_MT5_PORTA", "3200"))
FUSO_SERVIDOR_S = 3 * 3600  # Brasília = UTC−3; o MT5 entrega epoch "como se fosse UTC"
ESPERA_PRIMEIRO_TICK_S = 3.0
RECONECTA_A_CADA_S = 30
CANDLES_POR_RANGE = {"3mo": 70, "6mo": 135, "1y": 260, "2y": 520, "5y": 1300}
CANDLES_ULTIMO_NEGOCIO = 10

# A biblioteca MetaTrader5 não é thread-safe: toda chamada mt5.* passa por este lock.
LOCK = threading.Lock()


# ---------------------------------------------------------------------------------------------
# tempo
# ---------------------------------------------------------------------------------------------
def agora_servidor() -> int:
    return int(time.time()) - FUSO_SERVIDOR_S


def iso_servidor(ts: int | float | None) -> str | None:
    """Epoch "do servidor" → ISO com o deslocamento de Brasília (instante correto)."""
    if not ts:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S-03:00")


def data_servidor(ts: int | float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------------------------
# terminal, Market Watch e cache diário
# ---------------------------------------------------------------------------------------------
# O Market Watch aceita no máximo 5.000 símbolos (medido: a 5.001ª seleção falha em silêncio). Só
# símbolos selecionados recebem tick — para os demais `symbols_get` devolve last/bid/ask zerados.
# Então a ponte administra o orçamento: seleciona as séries dos vencimentos pedidos, lembra quem
# pediu quando e, faltando espaço, desseleciona vencidas e depois as séries do papel pedido há mais
# tempo (vencimento mais distante primeiro). Os papéis (ações) nunca saem.
LIMITE_MARKET_WATCH = 4800
# Negócios do dia e data do último negócio saem do candle D1 da série (15 ms cada, medido). Uma
# cadeia com 1.200 séries negociadas levaria 18 s se fosse tudo a cada pedido; por isso o cache
# diário por série, preenchido dentro de um orçamento por pedido (perto do dinheiro e vencimentos
# próximos primeiro) e completado por uma thread de fundo, que também renova o que venceu.
TTL_DIARIO_ABERTO_S = 120
TTL_DIARIO_FECHADO_S = 1800
ORCAMENTO_PADRAO_MS = 2500
ESPERA_MAX_MS = 15000
# Aquecimento: a ponte lembra (em disco) os papéis e recortes que já lhe pediram e, ao subir, volta a
# selecioná-los e a encher o cache diário em segundo plano — a primeira varredura do dia não paga
# os 3–10 s por papel que uma cadeia fria custa (medido: 29 papéis frios ≈ 2 min; quentes ≈ 3 s).
ARQUIVO_PAPEIS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "run", "ponte-mt5-papeis.json")


def pregao_aberto(ts: int) -> bool:
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.weekday() < 5 and 10 <= dt.hour < 18


class Terminal:
    def __init__(self) -> None:
        self.iniciado = False
        self.ultima_tentativa = 0.0
        # nome → {"ticker", "vencimento" (epoch), "pedidoEm" (time.time), "papel" (bool)}
        self.selecionados: dict[str, dict] = {}
        # nome → {"ultimoNegocioEm", "negociosNoDia", "quantidadeNoDia", "closeNoDia", "em"}
        self.diario: dict[str, dict] = {}
        self.fila_diario: list[str] = []
        self.na_fila: set[str] = set()
        # ticker → {"soMensal": bool, "maxExpiries": int} — o que já pediram, para aquecer ao subir
        self.papeis_pedidos: dict[str, dict] = self._ler_papeis()
        self.fila_aquecer: list[str] = list(self.papeis_pedidos)

    def _ler_papeis(self) -> dict[str, dict]:
        try:
            with open(ARQUIVO_PAPEIS, encoding="utf-8") as f:
                j = json.load(f)
            return {k: v for k, v in j.items() if isinstance(v, dict)} if isinstance(j, dict) else {}
        except (OSError, ValueError):
            return {}

    def lembrar_papel(self, ticker: str, so_mensal: bool, max_exp: int, banda: float | None) -> None:
        atual = self.papeis_pedidos.get(ticker)
        # guarda o recorte mais largo já pedido (a cadeia completa cobre a varredura)
        banda_atual = atual.get("bandaPct") if atual else 0.0
        banda_nova = None if banda is None or banda_atual is None else max(banda, banda_atual or 0.0)
        novo = {"soMensal": bool(so_mensal and (atual is None or atual.get("soMensal", True))), "maxExpiries": max(max_exp, atual.get("maxExpiries", 0) if atual else 0), "bandaPct": banda_nova}
        if atual == novo:
            return
        self.papeis_pedidos[ticker] = novo
        try:
            os.makedirs(os.path.dirname(ARQUIVO_PAPEIS), exist_ok=True)
            with open(ARQUIVO_PAPEIS, "w", encoding="utf-8") as f:
                json.dump(self.papeis_pedidos, f, ensure_ascii=False, indent=1)
        except OSError as e:  # pragma: no cover
            log(f"não consegui gravar {ARQUIVO_PAPEIS}: {e}")

    def garantir(self) -> tuple[bool, bool, str]:
        """(iniciado, logado, motivo). Tenta religar a cada RECONECTA_A_CADA_S quando caído."""
        if self.iniciado:
            ti = mt5.terminal_info()
            if ti is None:
                self.iniciado = False
                self.selecionados.clear()
        if not self.iniciado and time.time() - self.ultima_tentativa >= RECONECTA_A_CADA_S:
            self.ultima_tentativa = time.time()
            if mt5.initialize():
                self.iniciado = True
                self._herdar_market_watch()
                log(f"terminal ligado — Market Watch com {len(self.selecionados)} símbolo(s) herdado(s)")
            else:
                return False, False, f"initialize() falhou: {mt5.last_error()}"
        if not self.iniciado:
            return False, False, "terminal MetaTrader 5 não está aberto nesta máquina"
        ai = mt5.account_info()
        if ai is None:
            return True, False, "terminal aberto, mas deslogado"
        return True, True, ""

    # ---- Market Watch -------------------------------------------------------------------------
    def _herdar_market_watch(self) -> None:
        """O que o terminal já tinha selecionado entra no registro (com data zero: sai primeiro se faltar espaço)."""
        self.selecionados.clear()
        for s in mt5.symbols_get() or []:
            if not s.select:
                continue
            opcao = s.option_strike > 0 and s.expiration_time > 0
            self.selecionados[s.name] = {"ticker": s.basis if opcao else s.name, "vencimento": int(s.expiration_time) if opcao else 0, "pedidoEm": 0.0, "papel": not opcao}

    def selecionar_papel(self, ticker: str) -> bool:
        if ticker in self.selecionados:
            self.selecionados[ticker]["pedidoEm"] = time.time()
            return False
        if mt5.symbol_select(ticker, True):
            self.selecionados[ticker] = {"ticker": ticker, "vencimento": 0, "pedidoEm": time.time(), "papel": True}
            return True
        return False

    def selecionar_series(self, ticker: str, series: list) -> int:
        """Põe no Market Watch as séries que faltam, abrindo espaço se preciso. Devolve quantas entraram."""
        agora = time.time()
        faltam = [s for s in series if s.name not in self.selecionados]
        for s in series:
            if s.name in self.selecionados:
                self.selecionados[s.name]["pedidoEm"] = agora
        if not faltam:
            return 0
        self._abrir_espaco(len(faltam), ticker)
        novos = 0
        for s in faltam:
            if mt5.symbol_select(s.name, True):
                self.selecionados[s.name] = {"ticker": ticker, "vencimento": int(s.expiration_time), "pedidoEm": agora, "papel": False}
                novos += 1
        return novos

    def _abrir_espaco(self, precisa: int, ticker_atual: str) -> None:
        sobra = LIMITE_MARKET_WATCH - len(self.selecionados) - precisa
        if sobra >= 0:
            return
        agora_srv = agora_servidor()
        candidatas = [(n, r) for n, r in self.selecionados.items() if not r["papel"] and r["ticker"] != ticker_atual]
        # vencidas primeiro; depois o papel pedido há mais tempo, vencimento mais distante primeiro
        candidatas.sort(key=lambda nr: (0 if nr[1]["vencimento"] < agora_srv else 1, nr[1]["pedidoEm"], -nr[1]["vencimento"]))
        tirar = candidatas[: -sobra]
        for n, _ in tirar:
            mt5.symbol_select(n, False)
            self.selecionados.pop(n, None)
            self.diario.pop(n, None)
        if tirar:
            log(f"market watch: {len(tirar)} série(s) desselecionada(s) para abrir espaço ({len(self.selecionados)} ficam)")

    def limpar_vencidas(self) -> int:
        agora_srv = agora_servidor()
        vencidas = [n for n, r in self.selecionados.items() if not r["papel"] and 0 < r["vencimento"] < agora_srv]
        for n in vencidas:
            mt5.symbol_select(n, False)
            self.selecionados.pop(n, None)
            self.diario.pop(n, None)
        return len(vencidas)

    # ---- cache diário ---------------------------------------------------------------------------
    def diario_valido(self, nome: str) -> dict | None:
        d = self.diario.get(nome)
        if d is None:
            return None
        ttl = TTL_DIARIO_ABERTO_S if pregao_aberto(agora_servidor()) else TTL_DIARIO_FECHADO_S
        return d if time.time() - d["em"] < ttl else None

    def buscar_diario(self, nome: str) -> dict:
        """Candle D1 mais recente com negócio: data, negócios (tick_volume), quantidade, fechamento."""
        rates = mt5.copy_rates_from_pos(nome, mt5.TIMEFRAME_D1, 0, CANDLES_ULTIMO_NEGOCIO)
        d = {"ultimoNegocioEm": None, "negociosNoDia": None, "quantidadeNoDia": None, "closeNoDia": None, "em": time.time()}
        if rates is not None and len(rates):
            for c in reversed(rates):
                if int(c["tick_volume"]) > 0:
                    d.update(ultimoNegocioEm=data_servidor(int(c["time"])), negociosNoDia=int(c["tick_volume"]), quantidadeNoDia=float(c["real_volume"]), closeNoDia=float(c["close"]))
                    break
        self.diario[nome] = d
        self.na_fila.discard(nome)
        return d

    def enfileirar(self, nomes: list[str]) -> None:
        for n in nomes:
            if n not in self.na_fila:
                self.na_fila.add(n)
                self.fila_diario.append(n)

    def proximo_da_fila(self) -> str | None:
        while self.fila_diario:
            n = self.fila_diario.pop(0)
            if n in self.selecionados and self.diario_valido(n) is None:
                return n
            self.na_fila.discard(n)
        return None

    def proxima_vencida(self) -> str | None:
        """Uma série selecionada com cache diário vencido (renovação de fundo), a mais antiga."""
        pior = None
        for n, r in self.selecionados.items():
            if r["papel"]:
                continue
            d = self.diario.get(n)
            if d is not None and self.diario_valido(n) is None and (pior is None or d["em"] < self.diario[pior]["em"]):
                pior = n
        return pior


TERMINAL = Terminal()


def refresco_de_fundo() -> None:
    """Aquece os papéis já pedidos, completa a fila do cache diário e renova o que venceu — sem
    segurar o lock por muito tempo (uma série, ou um papel, por vez)."""
    while True:
        nome = None
        try:
            with LOCK:
                if TERMINAL.iniciado and mt5.account_info() is not None:
                    if TERMINAL.fila_aquecer:
                        t = TERMINAL.fila_aquecer.pop(0)
                        rec = TERMINAL.papeis_pedidos.get(t) or {}
                        n = aquecer_papel(t, bool(rec.get("soMensal", True)), int(rec.get("maxExpiries") or 1), rec.get("bandaPct"))
                        log(f"aquecendo {t}: {n} série(s) selecionada(s); {len(TERMINAL.fila_aquecer)} papel(is) na fila")
                        nome = t
                    else:
                        nome = TERMINAL.proximo_da_fila() or TERMINAL.proxima_vencida()
                        if nome:
                            TERMINAL.buscar_diario(nome)
        except Exception as e:  # pragma: no cover
            log(f"fundo: {type(e).__name__}: {e}")
        time.sleep(0.005 if nome else 1.0)


class ErroHttp(Exception):
    def __init__(self, status: int, erro: str) -> None:
        super().__init__(erro)
        self.status = status
        self.erro = erro


def exigir_logado() -> None:
    iniciado, logado, motivo = TERMINAL.garantir()
    if not iniciado:
        raise ErroHttp(503, motivo)
    if not logado:
        raise ErroHttp(503, "terminal deslogado")


def tick_com_espera(nome: str, espera_s: float) -> object | None:
    """Tick do símbolo; se acabou de entrar no Market Watch, espera o primeiro chegar."""
    limite = time.time() + espera_s
    while True:
        t = mt5.symbol_info_tick(nome)
        if t is not None and (t.last > 0 or t.bid > 0 or t.ask > 0) or time.time() >= limite:
            return t
        time.sleep(0.25)


def preco_ou_none(v: float | None) -> float | None:
    return float(v) if v is not None and v > 0 else None


# ---------------------------------------------------------------------------------------------
# rotas
# ---------------------------------------------------------------------------------------------
def rota_saude() -> dict:
    iniciado, logado, motivo = TERMINAL.garantir()
    ti = mt5.terminal_info() if iniciado else None
    ai = mt5.account_info() if logado else None
    return {
        "ok": iniciado and logado,
        "logado": logado,
        "motivo": motivo or None,
        "terminal": {"nome": ti.name, "build": ti.build, "conectado": bool(ti.connected)} if ti else None,
        "servidor": ai.server if ai else None,
        "simbolos": mt5.symbols_total() if iniciado else None,
        "marketWatch": {"selecionados": len(TERMINAL.selecionados), "limite": LIMITE_MARKET_WATCH, "filaDiario": len(TERMINAL.fila_diario), "cacheDiario": len(TERMINAL.diario), "aquecendo": len(TERMINAL.fila_aquecer), "papeisLembrados": len(TERMINAL.papeis_pedidos)},
        "agoraServidor": iso_servidor(agora_servidor()),
        "versaoPonte": VERSAO_PONTE,
    }


def rota_cotacao(q: dict) -> dict:
    exigir_logado()
    ticker = (q.get("ticker") or "").upper().strip()
    if not ticker or mt5.symbol_info(ticker) is None:
        raise ErroHttp(404, f"papel {ticker or '?'} não existe no catálogo")
    novo = TERMINAL.selecionar_papel(ticker)
    t = tick_com_espera(ticker, ESPERA_PRIMEIRO_TICK_S if novo else 0)
    if t is None:
        raise ErroHttp(502, f"sem tick para {ticker}")
    return {
        "ticker": ticker,
        "last": preco_ou_none(t.last),
        "bid": preco_ou_none(t.bid),
        "ask": preco_ou_none(t.ask),
        "volume": float(t.volume_real) if t.volume_real else None,
        "tickAt": iso_servidor(t.time),
        "sessao": data_servidor(t.time),
    }


def dentro_da_banda(s, spot: float | None, banda: float | None) -> bool:
    return banda is None or spot is None or abs(s.option_strike / spot - 1) <= banda / 100


def aquecer_papel(ticker: str, so_mensal: bool, max_exp: int, banda: float | None) -> int:
    """Seleciona as séries do recorte e enfileira o cache diário delas. Devolve quantas séries."""
    if mt5.symbol_info(ticker) is None:
        return 0
    TERMINAL.selecionar_papel(ticker)
    t = tick_com_espera(ticker, ESPERA_PRIMEIRO_TICK_S)
    spot = preco_ou_none(t.last) if t else None
    agora = agora_servidor()
    todas = mt5.symbols_get(f"{ticker[:4]}*") or []
    vigentes = [s for s in todas if s.option_strike > 0 and s.expiration_time >= agora and s.basis == ticker]
    sessao = data_servidor(t.time) if t and t.time else data_servidor(agora)
    datas = sorted({data_servidor(s.expiration_time) for s in vigentes if data_servidor(s.expiration_time) > sessao})
    if so_mensal:
        datas = [d for d in datas if e_mensal_aprox(d, datas)]
    conjunto = set(datas[:max_exp])
    escolhidas = [s for s in vigentes if data_servidor(s.expiration_time) in conjunto and dentro_da_banda(s, spot, banda)]
    TERMINAL.selecionar_series(ticker, escolhidas)
    TERMINAL.enfileirar([s.name for s in escolhidas if s.last > 0 and TERMINAL.diario_valido(s.name) is None])
    return len(escolhidas)


def rota_cadeia(q: dict) -> dict:
    exigir_logado()
    inicio = time.time()
    ticker = (q.get("ticker") or "").upper().strip()
    so_mensal = q.get("soMensal") == "1"
    max_exp = max(1, int(q.get("maxExpiries") or 8))
    orcamento_s = min(ESPERA_MAX_MS, max(0, int(q.get("esperaMs") or ORCAMENTO_PADRAO_MS))) / 1000
    banda = float(q["bandaPct"]) if q.get("bandaPct") else None
    if not ticker or mt5.symbol_info(ticker) is None:
        raise ErroHttp(404, f"papel {ticker or '?'} não existe no catálogo")
    TERMINAL.lembrar_papel(ticker, so_mensal, max_exp, banda)

    novo = TERMINAL.selecionar_papel(ticker)
    t = tick_com_espera(ticker, ESPERA_PRIMEIRO_TICK_S if novo else 0)
    spot = preco_ou_none(t.last) if t else None
    spot_fonte = "tick"
    if spot is None:
        # Papel sem tick (feriado longo, símbolo parado): o fechamento diário é o que existe.
        r = mt5.copy_rates_from_pos(ticker, mt5.TIMEFRAME_D1, 0, 1)
        if r is not None and len(r):
            spot = float(r[0]["close"])
            spot_fonte = "fechamento D1"
    if spot is None:
        raise ErroHttp(502, f"sem cotação para {ticker}")

    agora = agora_servidor()
    TERMINAL.limpar_vencidas()
    prefixo = f"{ticker[:4]}*"
    todas = mt5.symbols_get(prefixo) or []
    # base == papel: separa PETR3 de PETR4 e deixa de fora os instrumentos de exercício (sufixo E).
    vigentes = [s for s in todas if s.option_strike > 0 and s.expiration_time >= agora and s.basis == ticker]
    sessao = data_servidor(t.time) if t and t.time else data_servidor(agora)
    # A série que vence NA sessão corrente fica de fora (o MT5 a lista até 23:59:59, mas com 0 dias
    # úteis não há IV): no dia do vencimento o 1º mensal é o do mês seguinte.
    datas = sorted({data_servidor(s.expiration_time) for s in vigentes if data_servidor(s.expiration_time) > sessao})

    # Mensal/semanal, du e dte são decididos pela plataforma (lib/fonte-mt5.ts), que tem o
    # calendário. Aqui só se recorta: `soMensal` é "terceira sexta ou véspera", para não mandar
    # 2.000 séries quando a varredura quer 300.
    if so_mensal:
        datas = [d for d in datas if e_mensal_aprox(d, datas)]
    datas = datas[:max_exp]
    conjunto = set(datas)
    escolhidas = [s for s in vigentes if data_servidor(s.expiration_time) in conjunto and dentro_da_banda(s, spot, banda)]

    novos = TERMINAL.selecionar_series(ticker, escolhidas)
    if novos:
        # Símbolos recém-selecionados só recebem o primeiro tick depois de um instante; e os
        # objetos de `symbols_get` são fotografias — relê-se o bloco depois da espera.
        time.sleep(min(ESPERA_PRIMEIRO_TICK_S, 0.5 + novos / 400))
        todas = mt5.symbols_get(prefixo) or []
        escolhidas = [s for s in todas if s.option_strike > 0 and s.expiration_time >= agora and s.basis == ticker and data_servidor(s.expiration_time) in conjunto and dentro_da_banda(s, spot, banda)]

    # Cache diário: quem negociou alguma vez (last > 0) precisa da data do último negócio.
    # Perto do dinheiro e vencimento próximo primeiro; o que não couber no orçamento vai para a fila.
    ordem = {d: i for i, d in enumerate(datas)}
    precisam = [s for s in escolhidas if s.last > 0 and TERMINAL.diario_valido(s.name) is None]
    # quem teve tick na sessão corrente provavelmente negociou hoje: vai primeiro
    precisam.sort(key=lambda s: (0 if data_servidor(s.time) == sessao else 1, ordem[data_servidor(s.expiration_time)], abs(s.option_strike - spot)))
    limite = time.time() + orcamento_s
    prontas_agora = 0
    for s in precisam:
        if time.time() >= limite:
            break
        TERMINAL.buscar_diario(s.name)
        prontas_agora += 1
    pendentes = [s.name for s in precisam[prontas_agora:]]
    TERMINAL.enfileirar(pendentes)

    options = []
    for s in escolhidas:
        d = TERMINAL.diario.get(s.name) if s.last > 0 else None
        options.append(
            {
                "name": s.name,
                "type": "CALL" if s.option_right == 0 else "PUT",
                "model": "A" if s.option_mode == 1 else "E",
                "strike": float(s.option_strike),
                "expiry": data_servidor(s.expiration_time),
                "last": preco_ou_none(s.last),
                "bid": preco_ou_none(s.bid),
                "ask": preco_ou_none(s.ask),
                "tickAt": iso_servidor(s.time) if s.time else None,
                "ultimoNegocioEm": d["ultimoNegocioEm"] if d else None,
                "negociosNoDia": d["negociosNoDia"] if d else None,
                "quantidadeNoDia": d["quantidadeNoDia"] if d else None,
                "closeNoDia": d["closeNoDia"] if d else None,
                "diarioPendente": s.last > 0 and d is None,
            }
        )

    return {
        "ticker": ticker,
        "spot": spot,
        "spotFonte": spot_fonte,
        "spotTickAt": iso_servidor(t.time) if t and t.time else None,
        "sessao": sessao,
        "expiries": datas,
        "options": options,
        "bandaPct": banda,
        "vigentesNoCatalogo": len(vigentes),
        "diario": {"pedidas": len(precisam), "prontasAgora": prontas_agora, "pendentes": len(pendentes)},
        "marketWatch": {"selecionados": len(TERMINAL.selecionados), "novos": novos},
        "geradoEm": iso_servidor(agora),
        "duracaoMs": int((time.time() - inicio) * 1000),
    }


def e_mensal_aprox(d: str, todas: list[str]) -> bool:
    """Terceira sexta-feira do mês, ou a véspera quando a sexta é feriado e não há série nela."""
    dt = datetime.strptime(d, "%Y-%m-%d")
    primeiro = dt.replace(day=1)
    # weekday(): segunda=0 … sexta=4
    primeira_sexta = 1 + (4 - primeiro.weekday()) % 7
    terceira_sexta = primeira_sexta + 14
    if dt.day == terceira_sexta:
        return True
    ts = dt.replace(day=terceira_sexta).strftime("%Y-%m-%d")
    return 0 < terceira_sexta - dt.day <= 3 and ts not in todas


def rota_historico(q: dict) -> dict:
    exigir_logado()
    ticker = (q.get("ticker") or "").upper().strip()
    rng = q.get("range") or "1y"
    if rng not in CANDLES_POR_RANGE:
        raise ErroHttp(400, f"range inválido: {rng}")
    if not ticker or mt5.symbol_info(ticker) is None:
        raise ErroHttp(404, f"papel {ticker or '?'} não existe no catálogo")
    TERMINAL.selecionar_papel(ticker)
    rates = mt5.copy_rates_from_pos(ticker, mt5.TIMEFRAME_D1, 0, CANDLES_POR_RANGE[rng])
    if rates is None or len(rates) == 0:
        raise ErroHttp(502, f"sem candles para {ticker}: {mt5.last_error()}")
    candles = [
        {
            "date": data_servidor(int(c["time"])),
            "open": float(c["open"]),
            "high": float(c["high"]),
            "low": float(c["low"]),
            "close": float(c["close"]),
            "volume": float(c["real_volume"]),
        }
        for c in rates
        if float(c["close"]) > 0
    ]
    return {"ticker": ticker, "range": rng, "candles": candles, "source": "mt5", "updatedAt": iso_servidor(agora_servidor())}


def rota_ticks(q: dict) -> dict:
    exigir_logado()
    serie = (q.get("serie") or "").upper().strip()
    data = q.get("data") or data_servidor(agora_servidor())
    if not serie or mt5.symbol_info(serie) is None:
        raise ErroHttp(404, f"série {serie or '?'} não existe no catálogo")
    try:
        d0 = datetime.strptime(data, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise ErroHttp(400, f"data inválida: {data}")
    d1 = d0.replace(hour=23, minute=59, second=59)
    tk = mt5.copy_ticks_range(serie, d0, d1, mt5.COPY_TICKS_TRADE)
    if tk is None or len(tk) == 0:
        return {"serie": serie, "data": data, "negocios": 0, "quantidade": 0.0, "financeiro": 0.0, "primeiro": None, "ultimo": None}
    return {
        "serie": serie,
        "data": data,
        "negocios": int(len(tk)),
        "quantidade": float(tk["volume_real"].sum()),
        "financeiro": float((tk["last"] * tk["volume_real"]).sum()),
        "primeiro": iso_servidor(int(tk[0]["time"])),
        "ultimo": iso_servidor(int(tk[-1]["time"])),
    }


# ---------------------------------------------------------------------------------------------
# WO-62 — Macro e curva DI
# ---------------------------------------------------------------------------------------------
# Contratos contínuos "por liquidez" (sufixo $) e os DI1 por vencimento. Medido em 19/09/2026:
# IBOV, WIN$, IND$, DOL$, WDO$, ISP$, BIT$, DI1$, T10$, GLD$ têm tick e candle D1; VIX$, DAX$ e
# WTI$ estão mortos no servidor da Genial (último candle de meses ou anos atrás). O DI1 é cotado
# em TAXA (% a.a., 3 casas), um contrato por vencimento (F = janeiro, J = abril, N = julho,
# V = outubro), vencendo no 1º dia útil do mês.
CANDLES_CURVA_DI = 70
MAX_SIMBOLOS_MACRO = 40


def fechamentos_d1(nome: str, n: int) -> list[dict]:
    r = mt5.copy_rates_from_pos(nome, mt5.TIMEFRAME_D1, 0, n)
    if r is None:
        return []
    return [{"date": data_servidor(int(c["time"])), "close": float(c["close"])} for c in r if float(c["close"]) > 0]


def rota_macro(q: dict) -> dict:
    exigir_logado()
    inicio = time.time()
    pedidos = [x.strip().upper() for x in (q.get("simbolos") or "").split(",") if x.strip()][:MAX_SIMBOLOS_MACRO]
    rng = q.get("range") or "1y"
    if rng not in CANDLES_POR_RANGE:
        raise ErroHttp(400, f"range inválido: {rng}")
    if not pedidos:
        raise ErroHttp(400, "informe simbolos=A,B,C")
    novos = 0
    for n in pedidos:
        if mt5.symbol_info(n) is not None and TERMINAL.selecionar_papel(n):
            novos += 1
    if novos:
        time.sleep(min(ESPERA_PRIMEIRO_TICK_S, 0.5 + novos / 10))
    series = []
    for n in pedidos:
        i = mt5.symbol_info(n)
        if i is None:
            series.append({"simbolo": n, "ok": False, "motivo": "não existe no catálogo"})
            continue
        t = mt5.symbol_info_tick(n)
        candles = fechamentos_d1(n, CANDLES_POR_RANGE[rng])
        last = preco_ou_none(t.last) if t else None
        if last is None and not candles:
            series.append({"simbolo": n, "ok": False, "motivo": "sem tick e sem candle"})
            continue
        series.append({
            "simbolo": n,
            "ok": True,
            "descricao": i.description,
            "last": last,
            "tickAt": iso_servidor(t.time) if t and t.time else None,
            "sessao": data_servidor(t.time) if t and t.time else None,
            "candles": candles,
        })
    return {"series": series, "range": rng, "geradoEm": iso_servidor(agora_servidor()), "duracaoMs": int((time.time() - inicio) * 1000)}


def e_contrato_futuro(nome: str, prefixo: str) -> bool:
    """WO-69: DI1F27, DAPK27, DDIF30 - o contrato por vencimento, nunca os continuos ($, $D, @)."""
    return nome.startswith(prefixo) and len(nome) == 6 and nome[3].isalpha() and nome[4:].isdigit()


def e_contrato_di(nome: str) -> bool:
    # DI1F27, DI1N30… — nunca os contínuos (DI1$, DI1$D, DI1@…)
    return e_contrato_futuro(nome, "DI1")


def rota_curva_di(q: dict) -> dict:
    return rota_curva_futuros("DI1")


def rota_curva_dap(q: dict) -> dict:
    """WO-69: cupom de IPCA (DAP) - a curva de juro REAL da B3, ao vivo. Mesma forma da DI:
    12 contratos vivos, todos negociando (medido em 23/09/2026: DAPK27 a DAPQ60)."""
    return rota_curva_futuros("DAP")


def rota_curva_futuros(prefixo: str) -> dict:
    exigir_logado()
    inicio = time.time()
    agora = agora_servidor()
    contratos = [s for s in (mt5.symbols_get(f"{prefixo}*") or []) if e_contrato_futuro(s.name, prefixo) and s.expiration_time >= agora]
    contratos.sort(key=lambda s: s.expiration_time)
    novos = 0
    for s in contratos:
        if TERMINAL.selecionar_papel(s.name):
            novos += 1
    if novos:
        time.sleep(min(ESPERA_PRIMEIRO_TICK_S, 0.5 + novos / 10))
    saida = []
    sessao = data_servidor(agora)
    for s in contratos:
        t = mt5.symbol_info_tick(s.name)
        fech = fechamentos_d1(s.name, CANDLES_CURVA_DI)
        taxa = preco_ou_none(t.last) if t else None
        tick_at = iso_servidor(t.time) if t and t.time else None
        if taxa is None and fech:
            taxa = fech[-1]["close"]
        if taxa is None:
            continue
        if t and t.time and data_servidor(t.time) > sessao:
            sessao = data_servidor(t.time)
        saida.append({
            "contrato": s.name,
            "vencimento": data_servidor(s.expiration_time),
            "taxa": taxa,
            "bid": preco_ou_none(t.bid) if t else None,
            "ask": preco_ou_none(t.ask) if t else None,
            "tickAt": tick_at,
            "fechamentos": fech,
        })
    return {"contratos": saida, "sessao": sessao, "geradoEm": iso_servidor(agora), "duracaoMs": int((time.time() - inicio) * 1000)}


ROTAS = {"/saude": lambda q: rota_saude(), "/cotacao": rota_cotacao, "/cadeia": rota_cadeia, "/historico": rota_historico, "/ticks": rota_ticks, "/macro": rota_macro, "/curva-di": rota_curva_di, "/curva-dap": rota_curva_dap}


# ---------------------------------------------------------------------------------------------
# servidor
# ---------------------------------------------------------------------------------------------
def log(linha: str) -> None:
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {linha}")


class Handler(BaseHTTPRequestHandler):
    server_version = f"mt5-ponte/{VERSAO_PONTE}"

    def log_message(self, *_args) -> None:  # o log é o nosso
        pass

    def _responder(self, status: int, corpo: dict) -> None:
        dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(dados)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            # O cliente desistiu (timeout do lado da plataforma) antes da resposta: uma linha de log, sem traceback.
            log(f"cliente fechou a conexão antes da resposta ({self.path.split('?')[0]})")

    def do_GET(self) -> None:  # noqa: N802
        inicio = time.time()
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        rota = ROTAS.get(u.path)
        if rota is None:
            self._responder(404, {"erro": f"rota desconhecida: {u.path}"})
            return
        try:
            with LOCK:
                corpo = rota(q)
            status = 200
        except ErroHttp as e:
            corpo, status = {"erro": e.erro}, e.status
        except Exception as e:  # nunca um stack trace no corpo
            corpo, status = {"erro": f"falha interna: {type(e).__name__}"}, 500
            log(f"ERRO {u.path} {q}: {type(e).__name__}: {e}")
        self._responder(status, corpo)
        tam = len(corpo.get("options", corpo.get("contratos", corpo.get("series", [])))) if isinstance(corpo, dict) else 0
        log(f"{status} {u.path} {q.get('ticker') or q.get('serie') or ''} {int((time.time() - inicio) * 1000)} ms{f' · {tam} item(ns)' if tam else ''}")


def main() -> None:
    iniciado, logado, motivo = TERMINAL.garantir()
    log(f"ponte MT5 {VERSAO_PONTE} em http://{HOST}:{PORTA} — terminal {'ligado' if iniciado else 'ausente'}, {'logado' if logado else motivo}")
    threading.Thread(target=refresco_de_fundo, name="refresco-diario", daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORTA), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with LOCK:
            if TERMINAL.iniciado:
                mt5.shutdown()
        log("ponte encerrada")


if __name__ == "__main__":
    main()
