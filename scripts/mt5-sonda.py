# -*- coding: utf-8 -*-
"""
Sondagem do MetaTrader 5 (Genial) como fonte de dados para a plataforma.

Conecta ao terminal JÁ ABERTO E LOGADO (sem login/senha — a biblioteca fala com o processo
por IPC) e responde às perguntas que decidem a WO da ponte MT5:

  1. A conta está logada? Qual servidor/corretora? Conta netting ou hedge?
  2. As opções de PETR4/VALE3 aparecem no catálogo? Com strike, vencimento, tipo, exercício?
  3. Bid/ask/último/volume vêm preenchidos para as opções? O tick é de agora (tempo real)
     ou de 15 minutos atrás?
  4. Histórico diário do papel: quantos candles a corretora entrega? AZUL4/GOLL4/MRFG3 existem?

Uso:  python scripts/mt5-sonda.py [PETR4 VALE3 ...] [+ABEV3 +B3SA3 ...]
      (sem prefixo: papel detalhado com amostra da cadeia; com "+": só a checagem de existência)
"""
import sys
import time
from datetime import datetime, timezone, timedelta

sys.stdout.reconfigure(encoding="utf-8")

try:
    import MetaTrader5 as mt5
except ImportError:
    print("Biblioteca MetaTrader5 ausente: python -m pip install MetaTrader5")
    sys.exit(2)

PAPEIS = [a for a in sys.argv[1:] if not a.startswith("+")] or ["PETR4", "VALE3"]
HISTORICO = ["PETR4", "VALE3", "MBRF3", "BOVA11", "AZUL4", "GOLL4", "MRFG3"]  # os três últimos: retirados do universo na WO-61
BRT = timezone(timedelta(hours=-3))


def hora(ts):
    # O MT5 entrega os instantes no fuso do SERVIDOR (Genial = Brasília) embalados como se fossem
    # UTC. Lê-se sem converter.
    if not ts:
        return "—"
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%d/%m %H:%M:%S")


def agora_servidor():
    return int(time.time()) - 3 * 3600 + 0  # epoch "no fuso do servidor" (Brasília, UTC-3)


def secao(t):
    print(f"\n=== {t} ===")


if not mt5.initialize():
    print("initialize() falhou:", mt5.last_error())
    print("O terminal MetaTrader 5 precisa estar aberto (e logado) nesta máquina.")
    sys.exit(1)

secao("1. Terminal e conta")
ti = mt5.terminal_info()
ai = mt5.account_info()
print("terminal:", ti.name, "| build", ti.build, "| conectado:", ti.connected, "| trade permitido:", ti.trade_allowed)
print("caminho:", ti.path)
if ai is None:
    print("account_info() = None → o terminal NÃO está logado. Faça o login no terminal e rode de novo.")
    mt5.shutdown()
    sys.exit(1)
modos = {0: "netting", 1: "exchange", 2: "hedge"}
print(f"conta: logada | servidor: {ai.server} | corretora: {ai.company} | modo: {modos.get(ai.margin_mode, ai.margin_mode)}")
print(f"moeda: {ai.currency} | saldo: {ai.balance:.2f} | alavancagem: {ai.leverage}")
print("símbolos no catálogo:", mt5.symbols_total())
print("relógio local:", datetime.now(BRT).strftime("%d/%m %H:%M:%S"))

secao("2. Papel e cadeia de opções")
tipos = {0: "call", 1: "put"}
modos_ex = {0: "europeu", 1: "americano"}
for papel in PAPEIS:
    info = mt5.symbol_info(papel)
    if info is None:
        print(f"\n{papel}: símbolo não existe no catálogo")
        continue
    mt5.symbol_select(papel, True)
    time.sleep(0.5)
    tk = mt5.symbol_info_tick(papel)
    print(f"\n{papel}: {info.description} | bid {tk.bid} ask {tk.ask} last {tk.last} vol {tk.volume} | tick {hora(tk.time)}")

    raiz = papel[:4]
    todos = mt5.symbols_get(f"{raiz}*")
    hoje = agora_servidor()
    vencidas = [s for s in todos if s.option_strike > 0 and 0 < s.expiration_time < hoje]
    opcoes = [s for s in todos if s.option_strike > 0 and s.expiration_time >= hoje]
    print(f"símbolos {raiz}*: {len(todos)} | opções vencidas no catálogo: {len(vencidas)} | vigentes: {len(opcoes)}")
    if not opcoes:
        print("  nenhuma opção no catálogo — verificar versão do MT5 (Swing Trade) / habilitação")
        continue
    por_venc = {}
    for s in opcoes:
        d = datetime.fromtimestamp(s.expiration_time, tz=timezone.utc).date()
        por_venc.setdefault(d, []).append(s)
    for d in sorted(por_venc)[:8]:
        lst = por_venc[d]
        calls = sum(1 for s in lst if s.option_right == 0)
        puts = len(lst) - calls
        print(f"  venc {d:%d/%m/%Y}: {len(lst):3d} séries ({calls} calls / {puts} puts) | exercício {modos_ex.get(lst[0].option_mode, lst[0].option_mode)}")

    # amostra: 6 séries do primeiro vencimento perto do dinheiro, com tick ao vivo
    d0 = sorted(por_venc)[0]
    ref = tk.last or tk.bid
    perto = sorted(por_venc[d0], key=lambda s: abs(s.option_strike - ref))[:6]
    print(f"  amostra (venc {d0:%d/%m}, perto de {ref}):")
    for s in perto:
        mt5.symbol_select(s.name, True)
    time.sleep(1.0)
    for s in sorted(perto, key=lambda s: (s.option_right, s.option_strike)):
        t = mt5.symbol_info_tick(s.name)
        i = mt5.symbol_info(s.name)
        print(
            f"    {s.name:12s} {tipos.get(s.option_right, s.option_right):4s} K={s.option_strike:7.2f} "
            f"bid {t.bid:7.2f} ask {t.ask:7.2f} last {t.last:7.2f} volDia {i.session_volume if hasattr(i, 'session_volume') else '—'} "
            f"negócios {i.session_deals} | tick {hora(t.time)} | base {i.basis}"
        )

secao("2b. Universo: existe no catálogo / opções vigentes / último tick")
UNIVERSO = [a for a in sys.argv[1:] if a.startswith("+")]
for papel in [a[1:] for a in UNIVERSO]:
    info = mt5.symbol_info(papel)
    if info is None:
        print(f"  {papel:7s} NÃO EXISTE")
        continue
    mt5.symbol_select(papel, True)
    tk = mt5.symbol_info_tick(papel)
    hoje = agora_servidor()
    ops = [s for s in mt5.symbols_get(f"{papel[:4]}*") if s.option_strike > 0 and s.expiration_time >= hoje and s.basis == papel]
    vencs = sorted({datetime.fromtimestamp(s.expiration_time, tz=timezone.utc).date() for s in ops})
    print(f"  {papel:7s} last {tk.last:8.2f} tick {hora(tk.time)} | opções vigentes {len(ops):4d} | vencimentos {len(vencs)} (próx. {vencs[0] if vencs else '—'})")

secao("3. Histórico diário")
for papel in HISTORICO:
    info = mt5.symbol_info(papel)
    if info is None:
        print(f"{papel}: não existe no catálogo")
        continue
    mt5.symbol_select(papel, True)
    rates = mt5.copy_rates_from_pos(papel, mt5.TIMEFRAME_D1, 0, 2000)
    if rates is None or len(rates) == 0:
        print(f"{papel}: sem candles ({mt5.last_error()})")
        continue
    ini = datetime.fromtimestamp(int(rates[0]["time"]), tz=timezone.utc).date()
    fim = datetime.fromtimestamp(int(rates[-1]["time"]), tz=timezone.utc).date()
    print(f"{papel}: {len(rates)} candles D1, de {ini} a {fim} | último close {rates[-1]['close']}")

secao("4. Latência do feed")
tk1 = mt5.symbol_info_tick(PAPEIS[0])
atraso = agora_servidor() - tk1.time if tk1 and tk1.time else None
if atraso is None:
    print("sem tick")
else:
    print(f"último tick de {PAPEIS[0]} há {atraso:.0f} s (fora do pregão pode ser grande; em pregão, >900 s indica feed com 15 min de atraso)")

mt5.shutdown()
print("\nsondagem concluída")
