"use client";

/**
 * WO-48 §4 — a boleta rápida.
 *
 * Um formulário que faz tudo: abrir, aumentar, reduzir, fechar, corrigir. O que muda é o tipo e
 * o alvo (estrutura nova, estrutura existente, perna existente). Ordem de tab é a ordem da nota
 * de corretagem: ativo → instrumento → lado/quantidade → preço executado → custos → estrutura →
 * data → confirmar.
 *
 * Três regras da tela:
 *
 * 1. **O preço executado é o campo que nunca fica vazio.** Vem pré-preenchido com a marcação;
 *    o trader sobrescreve com o da nota. Marcação é sugestão, nota é verdade.
 * 2. **Custos são sugestão editável.** Calculados pela tabela vigente na data (`/api/custos`);
 *    sem tabela, ficam em branco com aviso — a plataforma não inventa percentual.
 * 3. **Prévia antes de gravar.** `?simular=1` roda a boleta no banco e reverte: mostra o preço
 *    médio resultante e os custos sem gravar nada. É a diferença entre "acho que" e "vai ficar".
 */

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Check, X, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { markInfo, useMarket } from "@/store/market";
import { UNIVERSE } from "@/lib/universe";
import { fmtBRL, fmtNum, fmtDateBR } from "@/lib/format";
import type { ConfigCustos, EstruturaRegistrada } from "@/lib/boletas";
import type { Position } from "@/lib/types";

type Tipo = "abertura" | "fechamento" | "caixa";
type Motivo = NonNullable<Position["motivoSaida"]>;

const MOTIVOS: { valor: Motivo; rotulo: string }[] = [
  { valor: "alvo", rotulo: "Alvo" },
  { valor: "stop", rotulo: "Stop" },
  { valor: "regime", rotulo: "Tendência virou" },
  { valor: "vencimento", rotulo: "Rolagem/venc." },
  { valor: "manual", rotulo: "Manual" },
];

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** Foco inicial — o atalho B abre a Carteira com a boleta focada. */
  focar?: boolean;
}

function agoraLocalIso(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function FormularioBoleta({ aberto, onFechar, focar }: Props) {
  const { ticker: tickerGlobal, chain, chainCache, refresh, positions, livro, sincronizarLivro } = useMarket();

  const [tipo, setTipo] = useState<Tipo>("abertura");
  const [ticker, setTicker] = useState(tickerGlobal);
  const [instrumento, setInstrumento] = useState<string>("__acao__");
  const [lado, setLado] = useState<1 | -1>(1);
  const [qtd, setQtd] = useState("100");
  const [preco, setPreco] = useState("");
  const [corretagem, setCorretagem] = useState("");
  const [emolumentos, setEmolumentos] = useState("");
  const [liquidacao, setLiquidacao] = useState("");
  const [estruturaAlvo, setEstruturaAlvo] = useState<string>("__nova__");
  const [pernaAlvo, setPernaAlvo] = useState<string>("");
  const [tese, setTese] = useState("");
  const [alvo, setAlvo] = useState("");
  const [regraSaida, setRegraSaida] = useState("");
  const [motivo, setMotivo] = useState<Motivo>("manual");
  const [executadoEm, setExecutadoEm] = useState(agoraLocalIso());
  const [custosCfg, setCustosCfg] = useState<ConfigCustos | null>(null);
  const [previa, setPrevia] = useState<{ medio?: number; custos?: number; texto: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const chainDoTicker = chainCache[ticker] ?? (chain?.ticker === ticker ? chain : null);

  // Chain do ativo escolhido, sem trocar o ativo global da plataforma.
  useEffect(() => {
    if (!aberto || !ticker) return;
    if (!chainCache[ticker] && chain?.ticker !== ticker) void refresh(ticker);
  }, [aberto, ticker, chainCache, chain, refresh]);

  // Tabela de custos vigente na data da execução.
  useEffect(() => {
    if (!aberto) return;
    const data = executadoEm.slice(0, 10);
    fetch(`/api/custos?data=${data}`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCustosCfg(j?.custos ?? null))
      .catch(() => setCustosCfg(null));
  }, [aberto, executadoEm]);

  const opcoes = useMemo(() => {
    if (!chainDoTicker) return [];
    return [...chainDoTicker.options].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);
  }, [chainDoTicker]);
  const opcao = useMemo(() => opcoes.find((o) => o.opTicker === instrumento) ?? null, [opcoes, instrumento]);

  const estruturasAbertas: EstruturaRegistrada[] = useMemo(
    () => livro.estruturas.filter((e) => !e.fechadaEm && e.ticker === ticker),
    [livro.estruturas, ticker]
  );
  const pernasAbertas = useMemo(
    () => positions.filter((p) => p.underlying === ticker && /^db-\d+$/.test(p.id)),
    [positions, ticker]
  );

  // Preço pré-preenchido pela marcação — sugestão, não verdade.
  useEffect(() => {
    if (!aberto) return;
    if (tipo === "caixa") return;
    if (tipo === "fechamento") {
      const p = pernasAbertas.find((x) => x.id === pernaAlvo);
      if (p) {
        const m = markInfo(p, chainCache).price;
        setPreco(m != null ? m.toFixed(2) : "");
        setQtd(String(Math.abs(p.qty)));
      }
      return;
    }
    if (instrumento === "__acao__") {
      setPreco(chainDoTicker?.spot != null ? chainDoTicker.spot.toFixed(2) : "");
    } else if (opcao) {
      setPreco(opcao.last != null ? opcao.last.toFixed(2) : "");
    }
  }, [aberto, tipo, instrumento, opcao, chainDoTicker, pernaAlvo, pernasAbertas, chainCache]);

  // Custos sugeridos pela tabela; editáveis.
  const financeiro = (Number(preco.replace(",", ".")) || 0) * (Number(qtd) || 0);
  useEffect(() => {
    if (tipo === "caixa") return;
    if (!custosCfg) return;
    setCorretagem(custosCfg.corretagemFixa.toFixed(2));
    setEmolumentos((financeiro * custosCfg.emolumentosPct).toFixed(2));
    setLiquidacao((financeiro * custosCfg.liquidacaoPct).toFixed(2));
  }, [custosCfg, financeiro, tipo]);

  const num = (v: string) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const montarEntrada = () => {
    const quando = new Date(executadoEm).toISOString();
    const q = Number(qtd);
    const p = num(preco);
    if (tipo === "caixa") {
      if (p == null || p <= 0) throw new Error("Informe o valor do aporte/retirada.");
      return { tipo: "caixa", origem: "manual", executadoEm: quando, ticker: "CAIXA", kind: "CAIXA", lado, quantidade: 1, preco: p };
    }
    if (!Number.isFinite(q) || q <= 0) throw new Error("Quantidade precisa ser positiva.");
    if (p == null || p < 0) throw new Error("Preço executado é obrigatório.");
    const custos = {
      corretagem: corretagem === "" ? null : num(corretagem),
      emolumentos: emolumentos === "" ? null : num(emolumentos),
      liquidacao: liquidacao === "" ? null : num(liquidacao),
    };
    if (tipo === "fechamento") {
      const m = /^db-(\d+)$/.exec(pernaAlvo);
      if (!m) throw new Error("Escolha a perna a fechar.");
      const perna = pernasAbertas.find((x) => x.id === pernaAlvo)!;
      return { tipo: "fechamento", origem: "manual", executadoEm: quando, ticker, kind: perna.kind, posicaoId: Number(m[1]), quantidade: q, preco: p, motivoSaida: motivo, ...custos };
    }
    const ehAcao = instrumento === "__acao__";
    if (!ehAcao && !opcao) throw new Error("Escolha o instrumento.");
    const base = {
      tipo: "abertura", origem: "manual", executadoEm: quando, ticker,
      kind: ehAcao ? "STOCK" : "OPTION",
      opTicker: ehAcao ? null : opcao!.opTicker,
      tipoOpcao: ehAcao ? null : opcao!.type,
      modelo: ehAcao ? null : opcao!.model,
      strike: ehAcao ? null : opcao!.strike,
      vencimento: ehAcao ? null : opcao!.expiry,
      lado, quantidade: q, preco: p,
      ivEntrada: ehAcao ? null : opcao!.iv,
      gregasEntrada: ehAcao ? { delta: 1, vega: 0, theta: 0 } : { delta: opcao!.delta, vega: opcao!.vega, theta: opcao!.theta },
      ...custos,
    };
    if (estruturaAlvo === "__nova__") {
      if (tese.trim().length === 0) throw new Error("A tese é obrigatória para abrir uma estrutura nova (as 3 perguntas do método).");
      const a = num(alvo);
      return { ...base, novaEstrutura: { tese: tese.trim(), alvo: a != null && a > 0 ? a : null, regraSaida: regraSaida.trim() || null } };
    }
    return { ...base, estruturaId: Number(estruturaAlvo) };
  };

  const chamar = async (simular: boolean) => {
    setErro(null);
    setOk(null);
    let entrada: Record<string, unknown>;
    try {
      entrada = montarEntrada();
    } catch (e: any) {
      setErro(e.message);
      return;
    }
    setGravando(true);
    try {
      const res = await fetch(`/api/boletas${simular ? "?simular=1" : ""}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entrada), signal: AbortSignal.timeout(20_000),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(j?.error ?? j?.aviso ?? `Recusada (${res.status}).`);
        return;
      }
      const r = j?.resultados?.[0];
      if (simular) {
        const c = r?.custos;
        setPrevia({
          custos: c ? c.corretagem + c.emolumentos + c.liquidacao : undefined,
          texto: c
            ? `Custos ${c.calculadoPelaTabela ? "pela tabela" : "informados"}: ${fmtBRL(c.corretagem + c.emolumentos + c.liquidacao)}${r?.estruturaId ? ` · estrutura #${r.estruturaId}` : ""}`
            : "Prévia sem custos.",
        });
        return;
      }
      setOk(`Boleta #${r?.boletaId} gravada.`);
      setPrevia(null);
      setTese(""); setAlvo(""); setRegraSaida("");
      await sincronizarLivro();
    } catch (e: any) {
      setErro(`Falha: ${e?.message ?? "erro"}`);
    } finally {
      setGravando(false);
    }
  };

  if (!aberto) return null;

  const semBanco = !livro.configurado;

  return (
    <div className="panel border-l-2 !border-l-term-cyan">
      <div className="panel-title flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList size={14} className="text-term-cyan" />
          <span className="font-bold">Boleta</span>
          <span className="text-xxs text-term-dim font-normal">atalho B · Enter confirma · Esc fecha</span>
        </div>
        <button className="text-term-dim hover:text-term-text" onClick={onFechar} aria-label="Fechar a boleta"><X size={14} /></button>
      </div>

      {semBanco ? (
        <div className="p-3 text-xxs text-term-gold flex items-start gap-2">
          <TriangleAlert size={12} className="shrink-0 mt-0.5" />
          <span>{livro.aviso ?? "Banco não configurado."} A boleta fica desabilitada: a plataforma não guarda boleta só no navegador.</span>
        </div>
      ) : (
        <form
          className="p-3 space-y-2.5 text-xxs"
          onSubmit={(e) => { e.preventDefault(); void chamar(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") onFechar(); }}
        >
          {/* tipo */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(["abertura", "fechamento", "caixa"] as Tipo[]).map((t) => (
              <button type="button" key={t} onClick={() => { setTipo(t); setPrevia(null); }}
                className={clsx("px-2 py-1 rounded border font-mono", tipo === t ? "bg-term-cyan/15 border-term-cyan/50 text-term-cyan" : "bg-term-panel2 border-term-line text-term-dim")}>
                {t === "abertura" ? "Abrir / aumentar" : t === "fechamento" ? "Fechar / reduzir" : "Caixa"}
              </button>
            ))}
            <span className="text-term-dim ml-auto">
              {custosCfg ? `custos pela tabela vigente desde ${fmtDateBR(custosCfg.vigenteDesde)}` : "tabela de custos não configurada — digite os custos"}
            </span>
          </div>

          {tipo !== "caixa" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <label className="space-y-0.5">
                <div className="text-term-dim">Ativo</div>
                <select value={ticker} onChange={(e) => { setTicker(e.target.value.toUpperCase()); setInstrumento("__acao__"); setPernaAlvo(""); }} autoFocus={focar} className="cell-input !w-full">
                  {UNIVERSE.map((u) => <option key={u.ticker} value={u.ticker}>{u.ticker}</option>)}
                  {!UNIVERSE.some((u) => u.ticker === ticker) && <option value={ticker}>{ticker}</option>}
                </select>
              </label>

              {tipo === "abertura" ? (
                <label className="space-y-0.5 md:col-span-2">
                  <div className="text-term-dim">Instrumento {opcoes.length === 0 && <span className="text-term-gold">(chain carregando…)</span>}</div>
                  <select value={instrumento} onChange={(e) => setInstrumento(e.target.value)} className="cell-input !w-full">
                    <option value="__acao__">Ação — {ticker}{chainDoTicker?.spot != null ? ` (${fmtNum(chainDoTicker.spot, 2)})` : ""}</option>
                    {opcoes.map((o) => (
                      <option key={o.opTicker} value={o.opTicker}>
                        {o.opTicker} · {o.type} {fmtNum(o.strike, 2)} · {fmtDateBR(o.expiry)} · últ {o.last != null ? fmtNum(o.last, 2) : "—"}{o.markQuality === "stale" ? " · STALE" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="space-y-0.5 md:col-span-2">
                  <div className="text-term-dim">Perna a fechar</div>
                  <select value={pernaAlvo} onChange={(e) => setPernaAlvo(e.target.value)} className="cell-input !w-full">
                    <option value="">— escolha —</option>
                    {pernasAbertas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.side === 1 ? "C" : "V"} {p.kind === "STOCK" ? "ação" : `${p.type} ${fmtNum(p.strike ?? 0, 2)} ${p.expiry ? fmtDateBR(p.expiry) : ""}`} × {Math.abs(p.qty)} @ {fmtNum(p.price, 2)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="space-y-0.5">
                <div className="text-term-dim">{tipo === "abertura" ? "Lado" : "Motivo"}</div>
                {tipo === "abertura" ? (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setLado(1)} className={clsx("flex-1 px-2 py-1 rounded border font-mono", lado === 1 ? "bg-term-up/15 border-term-up/50 text-term-up" : "bg-term-panel2 border-term-line text-term-dim")}>C</button>
                    <button type="button" onClick={() => setLado(-1)} className={clsx("flex-1 px-2 py-1 rounded border font-mono", lado === -1 ? "bg-term-down/15 border-term-down/50 text-term-down" : "bg-term-panel2 border-term-line text-term-dim")}>V</button>
                  </div>
                ) : (
                  <select value={motivo} onChange={(e) => setMotivo(e.target.value as Motivo)} className="cell-input !w-full">
                    {MOTIVOS.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
                  </select>
                )}
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {tipo !== "caixa" && (
              <label className="space-y-0.5">
                <div className="text-term-dim">Quantidade</div>
                <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="numeric" className="cell-input !w-full text-right" />
              </label>
            )}
            {tipo === "caixa" && (
              <label className="space-y-0.5">
                <div className="text-term-dim">Movimento</div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setLado(1)} className={clsx("flex-1 px-2 py-1 rounded border font-mono", lado === 1 ? "bg-term-up/15 border-term-up/50 text-term-up" : "bg-term-panel2 border-term-line text-term-dim")}>Aporte</button>
                  <button type="button" onClick={() => setLado(-1)} className={clsx("flex-1 px-2 py-1 rounded border font-mono", lado === -1 ? "bg-term-down/15 border-term-down/50 text-term-down" : "bg-term-panel2 border-term-line text-term-dim")}>Retirada</button>
                </div>
              </label>
            )}
            <label className="space-y-0.5">
              <div className="text-term-dim">{tipo === "caixa" ? "Valor (R$)" : "Preço executado"}</div>
              <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder={tipo === "caixa" ? "" : "da nota"}
                className={clsx("cell-input !w-full text-right", preco === "" && "border-term-down")} />
            </label>
            {tipo !== "caixa" && (
              <>
                <label className="space-y-0.5">
                  <div className="text-term-dim">Corretagem</div>
                  <input value={corretagem} onChange={(e) => setCorretagem(e.target.value)} inputMode="decimal" className="cell-input !w-full text-right" />
                </label>
                <label className="space-y-0.5">
                  <div className="text-term-dim">Emolumentos</div>
                  <input value={emolumentos} onChange={(e) => setEmolumentos(e.target.value)} inputMode="decimal" className="cell-input !w-full text-right" />
                </label>
                <label className="space-y-0.5">
                  <div className="text-term-dim">Liquidação</div>
                  <input value={liquidacao} onChange={(e) => setLiquidacao(e.target.value)} inputMode="decimal" className="cell-input !w-full text-right" />
                </label>
              </>
            )}
            <label className="space-y-0.5">
              <div className="text-term-dim">Executada em</div>
              <input type="datetime-local" value={executadoEm} onChange={(e) => setExecutadoEm(e.target.value)} className="cell-input !w-full" />
            </label>
          </div>

          {tipo === "abertura" && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <label className="space-y-0.5">
                <div className="text-term-dim">Estrutura</div>
                <select value={estruturaAlvo} onChange={(e) => setEstruturaAlvo(e.target.value)} className="cell-input !w-full">
                  <option value="__nova__">Nova estrutura</option>
                  {estruturasAbertas.map((e) => (
                    <option key={e.id} value={String(e.id)}>#{e.id} · {e.nomeDetectado ?? "estrutura"} · {fmtDateBR(e.abertaEm.slice(0, 10))}</option>
                  ))}
                </select>
              </label>
              {estruturaAlvo === "__nova__" && (
                <>
                  <label className="space-y-0.5 md:col-span-2">
                    <div className="text-term-dim">1. Tese <span className="text-term-down">*</span></div>
                    <input value={tese} onChange={(e) => setTese(e.target.value)} placeholder="o que vai acontecer, e por quê" className={clsx("cell-input !w-full !text-left", tese.trim() === "" && "border-term-down")} />
                  </label>
                  <label className="space-y-0.5">
                    <div className="text-term-dim">2. Alvo (preço do ativo)</div>
                    <input value={alvo} onChange={(e) => setAlvo(e.target.value)} inputMode="decimal" className="cell-input !w-full text-right" />
                  </label>
                  <label className="space-y-0.5 md:col-span-4">
                    <div className="text-term-dim">3. Regra de saída</div>
                    <input value={regraSaida} onChange={(e) => setRegraSaida(e.target.value)} placeholder="realizo em 70% do máximo; rolo a 10 du; fecho a 5 du; saio se a tendência virar" className="cell-input !w-full !text-left" />
                  </label>
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" disabled={gravando} className="btn btn-primary flex items-center gap-1 disabled:opacity-50">
              <Check size={12} /> {gravando ? "Gravando…" : "Boletar"}
            </button>
            <button type="button" disabled={gravando} onClick={() => void chamar(true)} className="btn flex items-center gap-1">
              Prévia (não grava)
            </button>
            {financeiro > 0 && tipo !== "caixa" && (
              <span className="text-term-dim font-mono">financeiro {fmtBRL(financeiro)}</span>
            )}
            {previa && <span className="text-term-cyan">{previa.texto}</span>}
            {ok && <span className="text-term-up">{ok}</span>}
            {erro && <span className="text-term-down">{erro}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
