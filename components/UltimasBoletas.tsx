"use client";

/**
 * WO-58 — as últimas boletas do livro. Fecha o ciclo da Boletagem: registrei? está lá.
 * WO-68 — e conserta: cada linha tem "Corrigir", que grava o estorno e a boleta certa. A boleta que
 * já foi corrigida some da leitura do dia a dia e volta num clique, com a original riscada e o
 * estorno — a fita mostra o que VALE, e a trilha inteira continua no banco e no Excel.
 */

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtDateBR, fmtNum } from "@/lib/format";
import { colapsarFita, motivoDeNaoPoderCorrigir } from "@/lib/correcao-boleta";
import { CorrigirBoleta } from "@/components/CorrigirBoleta";
import type { BoletaRegistrada } from "@/lib/boletas";

const TIPO_CLS: Record<string, string> = {
  abertura: "text-term-cyan",
  fechamento: "text-term-gold",
  ajuste: "text-term-dim",
  exercicio: "text-term-gold",
  vencimento: "text-term-dim",
  caixa: "text-term-up",
};

function instrumento(b: BoletaRegistrada) {
  if (b.kind === "CAIXA") return "caixa";
  if (b.kind === "STOCK") return `${b.ticker} (ação)`;
  return `${b.opTicker ?? "?"} · ${b.tipoOpcao ?? ""} ${b.strike != null ? fmtNum(b.strike) : ""}`;
}

export function UltimasBoletas({ limite = 20 }: { limite?: number }) {
  const livro = useMarket((st) => st.livro);
  const [corrigindo, setCorrigindo] = useState<BoletaRegistrada | null>(null);
  const [trilhaAberta, setTrilhaAberta] = useState<number | null>(null);

  // Estornadas e estornos saem do alcance do botão: a versão que vale é outra linha.
  const contexto = useMemo(() => {
    const estornadas = new Set<number>();
    const estornos = new Set<number>();
    for (const b of livro.boletas) {
      if (b.tipo === "ajuste" && b.estornaId != null) {
        estornadas.add(b.estornaId);
        estornos.add(b.id);
      }
    }
    return { estornadas, estornos };
  }, [livro.boletas]);

  const linhas = useMemo(() => colapsarFita(livro.boletas).slice(0, limite), [livro.boletas, limite]);

  if (!livro.configurado) return null;

  return (
    <>
      {corrigindo && <CorrigirBoleta boleta={corrigindo} onFechar={() => setCorrigindo(null)} />}

      <div id="ultimas-boletas" className="panel">
        <div className="panel-title flex items-center gap-2">
          <span className="font-bold">Últimas boletas ({linhas.length} de {livro.totalBoletas})</span>
          <span className="text-xxs text-term-dim font-normal">a fita, mais recente primeiro — boletou errado? corrija na linha</span>
          <Link href="/portfolio#estruturas" className="text-xxs text-term-cyan ml-auto">ver as estruturas no Portfolio →</Link>
        </div>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-xxs tabular-nums">
            <thead className="border-b border-term-line">
              <tr>
                {["Executada", "Tipo", "Origem", "Instrumento", "Lado", "Qtd", "Preço", "Custos", "Motivo", "Nota", ""].map((h, i) => (
                  <th key={i} className="th text-right first:text-left [&:nth-child(4)]:text-left [&:nth-child(10)]:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ vigente: b, trilha, corrigidaEm }) => {
                const impedimento = motivoDeNaoPoderCorrigir(b, {
                  jaEstornada: contexto.estornadas.has(b.id),
                  ehEstorno: contexto.estornos.has(b.id),
                });
                const aberta = trilhaAberta === b.id;
                return (
                  <Fragment key={b.id}>
                    <tr className="border-b border-term-line/40">
                      <td className="td text-term-dim">{new Date(b.executadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td className={`td text-right font-mono ${TIPO_CLS[b.tipo] ?? ""}`}>{b.tipo}</td>
                      <td className="td text-right text-term-dim">{b.origem}</td>
                      <td className="td font-mono">
                        {instrumento(b)}
                        {b.vencimento && <span className="text-term-dim"> · {fmtDateBR(b.vencimento)}</span>}
                        {corrigidaEm && (
                          <button
                            onClick={() => setTrilhaAberta(aberta ? null : b.id)}
                            className="ml-1.5 tag bg-term-cyan/15 text-term-cyan"
                            title={`Esta boleta corrige a #${b.corrigeId}, estornada em ${new Date(corrigidaEm).toLocaleString("pt-BR")}. Clique para ver a original e o estorno.`}
                          >
                            corrigida {aberta ? "▴" : "▾"}
                          </button>
                        )}
                      </td>
                      <td className={`td text-right font-mono ${b.lado === 1 ? "text-term-up" : b.lado === -1 ? "text-term-down" : ""}`}>{b.lado === 1 ? "C" : b.lado === -1 ? "V" : "—"}</td>
                      <td className="td text-right">{b.quantidade}</td>
                      <td className="td text-right font-mono">{fmtBRL(b.preco)}</td>
                      <td className="td text-right font-mono text-term-dim">{fmtBRL(b.custosTotal)}</td>
                      <td className="td text-right text-term-dim">{b.motivoSaida ?? "—"}</td>
                      <td className="td text-term-dim truncate max-w-[16rem]" title={b.nota ?? undefined}>{b.nota ?? ""}</td>
                      <td className="td text-right">
                        {impedimento ? (
                          <span className="text-term-dim cursor-help" title={impedimento}>—</span>
                        ) : (
                          <button className="tag bg-term-panel2 text-term-cyan hover:bg-term-cyan/15" onClick={() => setCorrigindo(b)} title="Grava o estorno desta boleta e a versão certa, na mesma transação. Nada é apagado.">
                            corrigir
                          </button>
                        )}
                      </td>
                    </tr>
                    {aberta &&
                      trilha.map((t) => (
                        <tr key={`${b.id}-${t.id}`} className="border-b border-term-line/20 bg-term-panel2/30">
                          <td className="td text-term-dim pl-4">↳ {new Date(t.executadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                          <td className={`td text-right font-mono ${TIPO_CLS[t.tipo] ?? ""}`}>{t.tipo}</td>
                          <td className="td text-right text-term-dim">#{t.id}</td>
                          <td className={clsx("td font-mono text-term-dim", t.tipo !== "ajuste" && "line-through")}>{instrumento(t)}</td>
                          <td className="td text-right font-mono text-term-dim">{t.lado === 1 ? "C" : t.lado === -1 ? "V" : "—"}</td>
                          <td className="td text-right text-term-dim">{t.quantidade}</td>
                          <td className={clsx("td text-right font-mono text-term-dim", t.tipo !== "ajuste" && "line-through")}>{fmtBRL(t.preco)}</td>
                          <td className="td text-right font-mono text-term-dim">{fmtBRL(t.custosTotal)}</td>
                          <td className="td text-right text-term-dim">{t.motivoSaida ?? "—"}</td>
                          <td className="td text-term-dim" colSpan={2}>{t.tipo === "ajuste" ? "estorno da original" : "como foi boletada"}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              {linhas.length === 0 && (
                <tr><td colSpan={11} className="td text-term-dim py-3">Nenhuma boleta no livro ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
