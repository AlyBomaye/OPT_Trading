"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Wind } from "lucide-react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { CartaoDriver, fmtVarDriver } from "@/components/CartaoDriver";
import { resumoDoBook, type EstruturaParaDrivers, type ExposicaoBook, type ExposicaoDriver } from "@/lib/drivers-book";
import type { DriversBody, VentoDrivers } from "@/lib/drivers-calculos";
import { fmtBRL, fmtDateBR } from "@/lib/format";

/**
 * WO-66 — "O que move o book" (Portfolio, abaixo do bloco de perfil de risco): a exposição do
 * book por driver (comprado/vendido, pesado pelo prêmio em risco da Alocação) e o vento por
 * estrutura, com os 5 cartões da WO-64 sob demanda. A conta é de `lib/drivers-book.ts`; a página
 * a entrega já feita (as flags e o agente usam a mesma). Nada aqui é veto nem hedge sugerido.
 */

interface Props {
  estruturas: EstruturaParaDrivers[];
  porPapel: Record<string, DriversBody>;
  erros: Record<string, string>;
  carregando: boolean;
  exposicao: ExposicaoBook;
}

const COR_SITUACAO: Record<VentoDrivers["situacao"], string> = {
  ok: "bg-term-up/15 text-term-up",
  atencao: "bg-term-gold/15 text-term-gold",
  fora: "bg-term-down/15 text-term-down",
  indefinido: "bg-term-panel2 text-term-dim",
};
const ROTULO_SITUACAO: Record<VentoDrivers["situacao"], string> = { ok: "a favor", atencao: "misto", fora: "contra", indefinido: "só leitura" };
const COR_VENTO_LIQUIDO: Record<ExposicaoDriver["vento"], string> = { "a favor": "text-term-up", contra: "text-term-down", parado: "text-term-dim", "sem lado": "text-term-dim" };
const ROTULO_VIES: Record<EstruturaParaDrivers["vies"], string> = { ALTA: "alta", BAIXA: "baixa", NEUTRA: "sem lado" };

function partes(lista: ExposicaoDriver["comprados"]): string {
  return lista.map((p) => `${p.underlying}${p.nome ? ` (${p.nome})` : ""} ${fmtBRL(p.peso, 0)}`).join(" · ");
}

export function PainelDriversBook({ estruturas, porPapel, erros, carregando, exposicao }: Props) {
  const [aberto, setAberto] = usePersistedState<boolean>("portfolio-drivers-open", true);
  const [expandida, setExpandida] = useState<string | null>(null);
  const papeis = useMemo(() => Array.from(new Set(estruturas.map((e) => e.underlying))), [estruturas]);
  const resumo = resumoDoBook(exposicao, estruturas.length);
  const errosLista = Object.entries(erros);

  return (
    <div id="drivers-book" className="panel">
      <div onClick={() => setAberto(!aberto)} className="panel-title flex items-center justify-between cursor-pointer select-none gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Wind size={14} className="text-term-cyan" />
          <span className="font-bold">O que move o book — {papeis.length} papel(is) · {estruturas.length} estrutura(s)</span>
          <span className="text-xxs text-term-dim font-normal hidden md:inline">a mesma aposta em papéis diferentes, pelo driver</span>
        </div>
        {carregando ? (
          <span className="tag bg-term-panel2 text-term-dim">buscando…</span>
        ) : (
          <span
            className={clsx("tag whitespace-nowrap", exposicao.concentracao || exposicao.contraOVento.length ? "bg-term-gold/15 text-term-gold" : "bg-term-panel2 text-term-dim")}
            title={resumo}
          >
            {resumo}
          </span>
        )}
      </div>

      {aberto && (
        <div className="px-2 pb-2 space-y-3 text-xxs">
          {estruturas.length === 0 && <div className="text-term-dim">Sem estrutura aberta: nada a expor.</div>}
          {errosLista.length > 0 && (
            <div className="text-term-down">
              {errosLista.map(([t, e]) => (
                <div key={t}>{t}: {e}</div>
              ))}
            </div>
          )}

          {/* 1. Exposição do book por driver */}
          {exposicao.exposicoes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xxs tabular-nums">
                <thead className="border-b border-term-line">
                  <tr>
                    {["Driver", "Comprado via", "Vendido via", "Líquido", "21p", "Vento", "Sem lado"].map((h, i) => (
                      <th key={h} className={clsx("th", i === 0 || i === 1 || i === 2 || i === 6 ? "text-left" : "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exposicao.exposicoes.map((x) => (
                    <tr key={x.codigo} className={clsx("border-b border-term-line/40", exposicao.concentracao?.codigo === x.codigo && "bg-term-gold/5")}>
                      <td className="td font-mono">
                        <span className="text-term-text font-bold">{x.nome}</span>
                        {x.stale && <span className="tag ml-1 bg-term-gold/15 text-term-gold">STALE</span>}
                        {x.emMovimento && <span className="tag ml-1 bg-term-panel2 text-term-text" title="|z| ≥ 1: longe do nível normal dos últimos 252 pregões">em movimento</span>}
                        {exposicao.concentracao?.codigo === x.codigo && (
                          <span className="tag ml-1 bg-term-gold/15 text-term-gold" title={`${Math.round(exposicao.concentracao.fracao * 100)}% do prêmio em risco direcional, ${exposicao.concentracao.estruturas} estruturas na mesma direção`}>
                            concentra {Math.round(exposicao.concentracao.fracao * 100)}%
                          </span>
                        )}
                        {x.ate && <div className="text-term-dim">medido até {fmtDateBR(x.ate)}</div>}
                      </td>
                      <td className="td text-term-up">{x.comprados.length ? partes(x.comprados) : "—"}</td>
                      <td className="td text-term-down">{x.vendidos.length ? partes(x.vendidos) : "—"}</td>
                      <td className={clsx("td text-right font-mono", x.liquido > 0 ? "text-term-up" : x.liquido < 0 ? "text-term-down" : "text-term-dim")}>
                        {x.liquido === 0 ? "—" : `${x.liquido > 0 ? "+" : "−"}${fmtBRL(Math.abs(x.liquido), 0)}`}
                      </td>
                      <td className={clsx("td text-right font-mono", x.var21 == null ? "text-term-dim" : x.var21 > 0 ? "text-term-up" : x.var21 < 0 ? "text-term-down" : "text-term-dim")}>
                        {fmtVarDriver(x.var21, x.unidade)}
                      </td>
                      <td className={clsx("td text-right font-mono", COR_VENTO_LIQUIDO[x.vento])} title="sinal do líquido × sinal da variação do driver em 21 pregões">{x.vento}</td>
                      <td className="td text-term-dim">{x.semLado.length ? x.semLado.map((s) => `${s.underlying}${s.nome ? ` (${s.nome})` : ""}`).join(" · ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 2. Vento por estrutura */}
          {estruturas.length > 0 && (
            <div className="space-y-1">
              {estruturas.map((e) => {
                const vento = exposicao.ventos[e.chave];
                const drivers = porPapel[e.underlying]?.drivers ?? [];
                const contra = (vento?.votos ?? []).filter((v) => v.aFavor === false).map((v) => v.nome);
                const votos = new Map((vento?.votos ?? []).map((v) => [v.codigo, v]));
                const abertaEsta = expandida === e.chave;
                return (
                  <div key={e.chave} className="rounded border border-term-line bg-term-panel2/30">
                    <div className="flex items-center gap-2 px-2 py-1 flex-wrap cursor-pointer select-none" onClick={() => setExpandida(abertaEsta ? null : e.chave)}>
                      {abertaEsta ? <ChevronDown size={12} className="text-term-dim" /> : <ChevronRight size={12} className="text-term-dim" />}
                      <span className="font-mono font-bold text-term-cyan">{e.underlying}</span>
                      <span className="font-mono">{e.nome ?? "estrutura"}</span>
                      <span className="tag bg-term-panel2 text-term-dim">{ROTULO_VIES[e.vies]}</span>
                      <span className="text-term-dim" title="prêmio em risco (o peso na exposição)">{e.premioEmRisco != null ? fmtBRL(e.premioEmRisco, 0) : "sem peso"}</span>
                      {vento ? (
                        <span className={clsx("tag", COR_SITUACAO[vento.situacao])} title={vento.resumo}>
                          vento {ROTULO_SITUACAO[vento.situacao]}{vento.vies !== "NEUTRA" ? ` · ${vento.aFavor} a favor · ${vento.contra} contra` : ` · ${vento.emMovimento} em movimento`}
                        </span>
                      ) : (
                        <span className="tag bg-term-panel2 text-term-dim">{porPapel[e.underlying] ? "sem medida" : carregando ? "buscando…" : "sem drivers"}</span>
                      )}
                      {contra.length > 0 && <span className="text-term-down">contra: {contra.join(", ")}</span>}
                      {vento?.ate && <span className="text-term-dim ml-auto">até {fmtDateBR(vento.ate)}</span>}
                      <span className="text-term-cyan">{abertaEsta ? "fechar" : "ver"}</span>
                    </div>
                    {abertaEsta && drivers.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 px-2 pb-2">
                        {drivers.map((d) => (
                          <CartaoDriver key={d.codigo} d={d} voto={votos.get(d.codigo)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-term-dim flex flex-wrap gap-x-3 gap-y-0.5">
            <span>peso = prêmio em risco da estrutura (o mesmo da Alocação)</span>
            <span>direção = sinal(beta) × viés, só driver diário com |corr| ≥ 0,25 em 252 pregões</span>
            <span>vento do líquido = sinal(líquido) × sinal(21p)</span>
            <span>concentração: ≥ 50% do prêmio direcional num driver, ≥ 2 estruturas</span>
            {exposicao.semPeso.length > 0 && <span className="text-term-gold">{exposicao.semPeso.length} estrutura(s) com lado mas sem prêmio medido: não pesam</span>}
            <span className="text-term-gold">nada aqui é veto nem hedge: é a exposição, escrita</span>
          </div>
        </div>
      )}
    </div>
  );
}
