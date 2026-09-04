"use client";

/**
 * WO-58 — os rascunhos pendentes: o coração da Boletagem.
 *
 * Cada rascunho é uma estrutura esperando pela execução no Profit. A ficha de execução mostra,
 * perna a perna, o preço da montagem (só leitura, com a fonte) e pede o preço que saiu de verdade,
 * a quantidade e a hora. O slippage aparece com o sinal do operador. Confirmar só habilita quando
 * `validarParaConfirmar` não devolve impedimento — e os impedimentos ficam escritos ao lado, não
 * escondidos num botão cinza.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList, Check, Trash2, Save, PencilLine } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { useRascunhos } from "@/lib/hooks/useRascunhos";
import { useLivro } from "@/lib/hooks/useLivro";
import { calcularCustos } from "@/lib/boleta-calculos";
import { debitoCredito, pernasComPreco, slippage, slippageDoRascunho, validarParaConfirmar, type PernaRascunho, type Rascunho } from "@/lib/rascunho-calculos";
import { FormularioAbertura, type DadosAbertura } from "@/components/FormularioAbertura";
import { fmtBRL, fmtDateBR, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import type { MotivoSaida } from "@/lib/boletas";

const ORIGEM: Record<Rascunho["origem"], string> = {
  estrategia: "Estratégia",
  "portfolio-fechar": "Portfolio · fechar",
  "portfolio-rolar": "Portfolio · rolar",
  manual: "manual",
};
const TIPO: Record<Rascunho["tipo"], string> = { abertura: "abertura", fechamento: "fechamento", rolagem: "rolagem" };
const MOTIVOS: { valor: MotivoSaida; rotulo: string }[] = [
  { valor: "alvo", rotulo: "Alvo" },
  { valor: "stop", rotulo: "Stop" },
  { valor: "regime", rotulo: "Tendência virou" },
  { valor: "vencimento", rotulo: "Rolagem / vencimento" },
  { valor: "manual", rotulo: "Manual" },
];

function idade(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

function isoParaLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function localParaIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function agoraLocal(): string {
  return isoParaLocal(new Date().toISOString());
}
const parse = (v: string): number | null => {
  const n = Number((v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function PainelRascunhos() {
  const { rascunhos, configurado, carregando, erro, atualizar, confirmar, descartar } = useRascunhos("pendente");
  const [expandido, setExpandido] = useState<number | null>(null);

  // Deep link #rascunho-{id} abre a ficha.
  useEffect(() => {
    const ler = () => {
      const m = /^#rascunho-(\d+)$/.exec(window.location.hash);
      if (m) setExpandido(Number(m[1]));
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);
  useEffect(() => {
    if (expandido != null && rascunhos.length) {
      const el = document.getElementById(`rascunho-${expandido}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandido, rascunhos.length]);

  return (
    <div id="rascunhos" className="panel border-l-2 !border-l-term-cyan">
      <div className="panel-title flex items-center gap-2 flex-wrap">
        <ClipboardList size={14} className="text-term-cyan" />
        <span className="font-bold">Rascunhos pendentes ({rascunhos.length})</span>
        <span className="text-xxs text-term-dim font-normal">
          a estrutura esperando a execução no Profit — digite o que saiu de verdade e confirme
        </span>
        {carregando && <span className="text-xxs text-term-dim ml-auto">atualizando…</span>}
      </div>
      {configurado === false && (
        <div className="px-3 pb-3 text-xxs text-term-gold">Sem banco: não há rascunhos. Rode npm run setup:db.</div>
      )}
      {erro && <div className="px-3 pb-2 text-xxs text-term-down">{erro}</div>}
      {configurado && rascunhos.length === 0 && !carregando && (
        <div className="px-3 pb-3 text-xxs text-term-dim">
          Nenhum rascunho. Monte uma estrutura na Estratégia (8) e clique em Boletar, ou peça para fechar/rolar uma estrutura no Portfolio (3).
        </div>
      )}
      <div className="px-2 pb-2 space-y-1">
        {rascunhos.map((r) => (
          <Ficha
            key={r.id}
            r={r}
            aberta={expandido === r.id}
            onToggle={() => setExpandido(expandido === r.id ? null : r.id)}
            atualizar={atualizar}
            confirmar={confirmar}
            descartar={descartar}
          />
        ))}
      </div>
    </div>
  );
}

function Ficha({
  r,
  aberta,
  onToggle,
  atualizar,
  confirmar,
  descartar,
}: {
  r: Rascunho;
  aberta: boolean;
  onToggle: () => void;
  atualizar: (id: number, patch: { pernas?: PernaRascunho[]; motivoSaida?: MotivoSaida | null; nota?: string | null; plano?: Rascunho["plano"] }) => Promise<{ ok: boolean; mensagem: string | null }>;
  confirmar: (id: number) => Promise<{ ok: boolean; mensagem: string | null }>;
  descartar: (id: number) => Promise<{ ok: boolean; mensagem: string | null }>;
}) {
  const positions = useMarket((st) => st.positions);
  const { tabelaCustos } = useLivro();
  const [pernas, setPernas] = useState<PernaRascunho[]>(r.pernas);
  const [motivo, setMotivo] = useState<MotivoSaida | null>(r.motivoSaida);
  const [nota, setNota] = useState(r.nota ?? "");
  const [editandoPlano, setEditandoPlano] = useState(false);
  const [custosAbertos, setCustosAbertos] = useState<number | null>(null);
  const [estado, setEstado] = useState<"parado" | "guardando" | "confirmando" | "descartando">("parado");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);

  // O servidor é a verdade: quando o rascunho muda lá, o local acompanha.
  useEffect(() => {
    setPernas(r.pernas);
    setMotivo(r.motivoSaida);
    setNota(r.nota ?? "");
  }, [r.pernas, r.motivoSaida, r.nota]);

  const hoje = new Date().toISOString().slice(0, 10);
  const abertas = useMemo(() => positions.filter((p) => /^db-\d+$/.test(p.id)).map((p) => ({ id: Number(p.id.slice(3)), quantidade: Math.abs(p.qty) })), [positions]);
  const impedimentos = useMemo(() => validarParaConfirmar({ estado: r.estado, tipo: r.tipo, pernas }, abertas, hoje), [r.estado, r.tipo, pernas, abertas, hoje]);
  const sujo = JSON.stringify(pernas) !== JSON.stringify(r.pernas) || motivo !== r.motivoSaida || (nota || null) !== r.nota;

  const montagem = debitoCredito(r.pernas, "precoMontagem");
  const execucao = debitoCredito(pernas, "precoExecucao");
  const slip = slippageDoRascunho(pernas);
  const comPreco = pernasComPreco(pernas);

  const mudar = (i: number, patch: Partial<PernaRascunho>) => setPernas((ls) => ls.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const guardar = async (): Promise<boolean> => {
    setEstado("guardando");
    setMsg(null);
    const res = await atualizar(r.id, { pernas, motivoSaida: motivo, nota: nota || null });
    setEstado("parado");
    if (!res.ok) setMsg(res.mensagem);
    return res.ok;
  };
  const onConfirmar = async () => {
    if (impedimentos.length) return;
    setEstado("confirmando");
    setMsg(null);
    if (sujo) {
      const ok = await guardar();
      if (!ok) {
        setEstado("parado");
        return;
      }
    }
    const res = await confirmar(r.id);
    setEstado("parado");
    setMsg(res.mensagem);
  };
  const onDescartar = async () => {
    setEstado("descartando");
    const res = await descartar(r.id);
    setEstado("parado");
    if (!res.ok) setMsg(res.mensagem);
  };
  const salvarPlano = async (d: DadosAbertura) => {
    const res = await atualizar(r.id, { plano: { tese: d.tese, alvo: d.alvo ?? null, regraSaida: d.regraSaida, regimeEntrada: d.regimeNaEntrada ?? null } });
    if (!res.ok) setMsg(res.mensagem);
    setEditandoPlano(false);
  };

  return (
    <div id={`rascunho-${r.id}`} className={clsx("rounded border text-xxs", aberta ? "border-term-cyan/40 bg-term-panel" : "border-term-line bg-term-panel2/40")}>
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer" onClick={onToggle}>
        {aberta ? <ChevronDown size={12} className="text-term-dim" /> : <ChevronRight size={12} className="text-term-dim" />}
        <span className="tag bg-term-panel2 text-term-dim border border-term-line">{ORIGEM[r.origem]}</span>
        <span className="font-mono font-bold text-term-cyan">{r.ticker}</span>
        <span className="font-mono">{r.nomeDetectado ?? TIPO[r.tipo]}</span>
        <span className="text-term-dim">· {r.pernas.length} perna(s) · {idade(r.criadoEm)}</span>
        {montagem != null && (
          <span className="font-mono text-term-dim" title="Débito (+) ou crédito (−) na montagem">
            montagem {montagem > 0 ? "débito" : "crédito"} {fmtBRL(Math.abs(montagem))}
          </span>
        )}
        <span className={clsx("ml-auto font-mono", comPreco === pernas.length ? "text-term-up" : "text-term-gold")}>
          {comPreco}/{pernas.length} com preço
        </span>
      </div>

      {aberta && (
        <div className="px-2 pb-2 space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-xxs tabular-nums">
              <thead className="border-b border-term-line">
                <tr>
                  {["", "Instrumento", "Qtd", "Montagem", "Execução (R$)", "Executado em", "Slippage", "Custos"].map((h, i) => (
                    <th key={i} className="th text-right first:text-left [&:nth-child(2)]:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pernas.map((p, i) => {
                  const s = slippage(p);
                  const fin = (p.precoExecucao ?? p.precoMontagem ?? 0) * p.quantidade;
                  const est = calcularCustos(tabelaCustos, fin, p.kind);
                  const custosTotal = p.custos
                    ? (p.custos.corretagem ?? est?.corretagem ?? 0) + (p.custos.emolumentos ?? est?.emolumentos ?? 0) + (p.custos.liquidacao ?? est?.liquidacao ?? 0) + (p.custos.registro ?? est?.registro ?? 0) + (p.custos.taxaOperacional ?? est?.taxaOperacional ?? 0)
                    : est?.total ?? null;
                  const semExecucao = p.precoExecucao == null;
                  return (
                    <tr key={i} className="border-b border-term-line/40 align-top">
                      <td className="td">
                        <span className={clsx("font-mono font-bold", p.lado === "compra" ? "text-term-up" : "text-term-down")}>{p.lado === "compra" ? "C" : "V"}</span>
                        {r.tipo === "rolagem" && <span className="tag ml-1 bg-term-panel2 text-term-dim">{p.papel}</span>}
                      </td>
                      <td className="td font-mono">
                        {p.kind === "STOCK" ? `${r.ticker} (ação)` : `${p.opTicker} · ${p.tipoOpcao} ${fmtNum(p.strike ?? 0)}`}
                        {p.vencimento && <span className="text-term-dim"> · {fmtDateBR(p.vencimento)}</span>}
                      </td>
                      <td className="td text-right">
                        <input
                          value={String(p.quantidade)}
                          onChange={(ev) => mudar(i, { quantidade: Math.max(0, Math.floor(Number(ev.target.value) || 0)) })}
                          inputMode="numeric"
                          className="cell-input !w-16 text-right"
                        />
                      </td>
                      <td className="td text-right font-mono text-term-dim" title={p.fontePrecoMontagem ? `fonte: ${p.fontePrecoMontagem}` : "sem marca na montagem"}>
                        {p.precoMontagem != null ? fmtBRL(p.precoMontagem) : "—"}
                        {p.fontePrecoMontagem && <span className="tag ml-1 bg-term-panel2 text-term-dim uppercase">{p.fontePrecoMontagem}</span>}
                      </td>
                      <td className="td text-right">
                        <input
                          value={p.precoExecucao != null ? String(p.precoExecucao) : ""}
                          onChange={(ev) => mudar(i, { precoExecucao: parse(ev.target.value), executadoEm: p.executadoEm ?? new Date().toISOString() })}
                          inputMode="decimal"
                          placeholder="do Profit"
                          className={clsx("cell-input !w-20 text-right", semExecucao ? "border-term-gold" : "")}
                        />
                      </td>
                      <td className="td text-right">
                        <input
                          type="datetime-local"
                          value={isoParaLocal(p.executadoEm) || (p.precoExecucao != null ? agoraLocal() : "")}
                          onChange={(ev) => mudar(i, { executadoEm: localParaIso(ev.target.value) })}
                          className="cell-input !w-40"
                        />
                      </td>
                      <td className={clsx("td text-right font-mono", s ? pnlColor(s.total) : "text-term-dim")} title="Do ponto de vista do operador: pagar mais numa compra é negativo; receber mais numa venda é positivo">
                        {s ? `${s.total > 0 ? "+" : ""}${fmtBRL(s.total)}${s.pct != null ? ` (${fmtPct(s.pct)})` : ""}` : "—"}
                      </td>
                      <td className="td text-right font-mono">
                        <button className="text-term-cyan hover:opacity-70" onClick={() => setCustosAbertos(custosAbertos === i ? null : i)} title={p.custos ? "custos sobrescritos — clique para editar" : "custos pela tabela vigente — clique para sobrescrever"}>
                          {custosTotal != null ? fmtBRL(custosTotal) : "—"}{p.custos ? " ✎" : ""}
                        </button>
                        {custosAbertos === i && (
                          <div className="mt-1 grid grid-cols-5 gap-1">
                            {(["corretagem", "emolumentos", "liquidacao", "registro", "taxaOperacional"] as const).map((k) => (
                              <label key={k} className="flex flex-col items-end">
                                <span className="text-term-dim">{k === "taxaOperacional" ? "tx.op." : k.slice(0, 6)}</span>
                                <input
                                  value={p.custos?.[k] != null ? String(p.custos[k]) : ""}
                                  placeholder={est ? est[k].toFixed(2) : ""}
                                  onChange={(ev) => mudar(i, { custos: { ...(p.custos ?? {}), [k]: parse(ev.target.value) } })}
                                  inputMode="decimal"
                                  className="cell-input !w-14 text-right"
                                />
                              </label>
                            ))}
                            <button className="col-span-5 text-term-dim text-left" onClick={() => mudar(i, { custos: null })}>voltar à tabela</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="font-mono">
                <span className="text-term-dim">execução: </span>
                {execucao != null ? <b>{execucao > 0 ? "débito" : "crédito"} {fmtBRL(Math.abs(execucao))}</b> : <span className="text-term-dim">— (faltam preços)</span>}
                {slip && (
                  <span className={clsx("ml-2", pnlColor(slip.total))} title="slippage total: execução contra montagem, do seu ponto de vista">
                    slippage {slip.total > 0 ? "+" : ""}{fmtBRL(slip.total)}{slip.pct != null ? ` (${fmtPct(slip.pct)} do prêmio)` : ""}
                  </span>
                )}
              </div>
              {(r.tipo === "fechamento" || r.tipo === "rolagem") && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-term-dim">Motivo:</span>
                  {MOTIVOS.map((m) => (
                    <button key={m.valor} onClick={() => setMotivo(m.valor)} className={clsx("px-2 py-0.5 rounded border font-mono", motivo === m.valor ? "bg-term-cyan/15 border-term-cyan/50 text-term-cyan" : "bg-term-panel2 border-term-line text-term-dim")}>
                      {m.rotulo}
                    </button>
                  ))}
                </div>
              )}
              <input value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="nota (opcional)" className="cell-input !w-full !text-left" />
            </div>

            {r.tipo === "abertura" && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">O plano (as três perguntas)</span>
                  <button className="text-term-cyan flex items-center gap-1" onClick={() => setEditandoPlano((v) => !v)}><PencilLine size={11} /> editar plano</button>
                </div>
                {!editandoPlano && (
                  <div className="text-term-dim space-y-0.5">
                    <div><span className="text-term-text">1. Tese:</span> {r.plano?.tese || "—"}</div>
                    <div><span className="text-term-text">2. Alvo:</span> {r.plano?.alvo != null ? `${r.ticker} a ${fmtBRL(r.plano.alvo)}` : "—"}</div>
                    <div><span className="text-term-text">3. Saída:</span> {r.plano?.regraSaida || "—"}</div>
                    {r.plano?.regimeEntrada && <div>regime na entrada: {r.plano.regimeEntrada}</div>}
                  </div>
                )}
                {editandoPlano && (
                  <FormularioAbertura
                    ticker={r.ticker}
                    precoAlvoSugerido={r.plano?.alvo ?? null}
                    lucroAlvoSugerido={null}
                    inicial={{ tese: r.plano?.tese ?? "", alvo: r.plano?.alvo ?? undefined, regraSaida: r.plano?.regraSaida ?? "" }}
                    rotuloConfirmar="Guardar plano"
                    onConfirmar={(d) => void salvarPlano(d)}
                    onCancelar={() => setEditandoPlano(false)}
                  />
                )}
              </div>
            )}
          </div>

          {impedimentos.length > 0 && (
            <div className="text-term-gold space-y-0.5">
              {impedimentos.map((m, i) => <div key={i}>· {m}</div>)}
            </div>
          )}
          {msg && <div className={clsx(/registrada/.test(msg) ? "text-term-up" : "text-term-down")}>{msg}</div>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button className="btn btn-primary flex items-center gap-1 disabled:opacity-50" disabled={impedimentos.length > 0 || estado !== "parado"} onClick={() => void onConfirmar()} title={impedimentos.length ? impedimentos.join(" ") : "Grava as pernas como boletas, todas numa transação"}>
              <Check size={12} /> {estado === "confirmando" ? "Confirmando…" : "Confirmar"}
            </button>
            <button className="btn flex items-center gap-1 disabled:opacity-50" disabled={!sujo || estado !== "parado"} onClick={() => void guardar()}>
              <Save size={12} /> {estado === "guardando" ? "Guardando…" : "Guardar rascunho"}
            </button>
            <span className="flex-1" />
            {!confirmarDescarte ? (
              <button className="btn text-term-down flex items-center gap-1" onClick={() => setConfirmarDescarte(true)} disabled={estado !== "parado"}><Trash2 size={12} /> Descartar</button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-term-down">descartar este rascunho?</span>
                <button className="btn text-term-down" onClick={() => void onDescartar()}>sim, descartar</button>
                <button className="btn text-term-dim" onClick={() => setConfirmarDescarte(false)}>não</button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
