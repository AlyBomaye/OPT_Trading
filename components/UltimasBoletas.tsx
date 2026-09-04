"use client";

/**
 * WO-58 — as últimas boletas do livro. Fecha o ciclo da Boletagem: registrei? está lá.
 */

import Link from "next/link";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtDateBR, fmtNum } from "@/lib/format";

const TIPO_CLS: Record<string, string> = {
  abertura: "text-term-cyan",
  fechamento: "text-term-gold",
  ajuste: "text-term-dim",
  exercicio: "text-term-gold",
  vencimento: "text-term-dim",
  caixa: "text-term-up",
};

export function UltimasBoletas({ limite = 20 }: { limite?: number }) {
  const livro = useMarket((st) => st.livro);
  if (!livro.configurado) return null;
  const boletas = livro.boletas.slice(0, limite);
  return (
    <div id="ultimas-boletas" className="panel">
      <div className="panel-title flex items-center gap-2">
        <span className="font-bold">Últimas boletas ({boletas.length} de {livro.totalBoletas})</span>
        <span className="text-xxs text-term-dim font-normal">a fita, mais recente primeiro</span>
        <Link href="/portfolio#estruturas" className="text-xxs text-term-cyan ml-auto">ver as estruturas no Portfolio →</Link>
      </div>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full text-xxs tabular-nums">
          <thead className="border-b border-term-line">
            <tr>
              {["Executada", "Tipo", "Origem", "Instrumento", "Lado", "Qtd", "Preço", "Custos", "Motivo", "Nota"].map((h, i) => (
                <th key={i} className="th text-right first:text-left [&:nth-child(4)]:text-left [&:nth-child(10)]:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {boletas.map((b) => (
              <tr key={b.id} className="border-b border-term-line/40">
                <td className="td text-term-dim">{new Date(b.executadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className={`td text-right font-mono ${TIPO_CLS[b.tipo] ?? ""}`}>{b.tipo}</td>
                <td className="td text-right text-term-dim">{b.origem}</td>
                <td className="td font-mono">
                  {b.kind === "CAIXA" ? "caixa" : b.kind === "STOCK" ? `${b.ticker} (ação)` : `${b.opTicker ?? "?"} · ${b.tipoOpcao ?? ""} ${b.strike != null ? fmtNum(b.strike) : ""}`}
                  {b.vencimento && <span className="text-term-dim"> · {fmtDateBR(b.vencimento)}</span>}
                </td>
                <td className={`td text-right font-mono ${b.lado === 1 ? "text-term-up" : b.lado === -1 ? "text-term-down" : ""}`}>{b.lado === 1 ? "C" : b.lado === -1 ? "V" : "—"}</td>
                <td className="td text-right">{b.quantidade}</td>
                <td className="td text-right font-mono">{fmtBRL(b.preco)}</td>
                <td className="td text-right font-mono text-term-dim">{fmtBRL(b.custosTotal)}</td>
                <td className="td text-right text-term-dim">{b.motivoSaida ?? "—"}</td>
                <td className="td text-term-dim truncate max-w-[16rem]" title={b.nota ?? undefined}>{b.nota ?? ""}</td>
              </tr>
            ))}
            {boletas.length === 0 && (
              <tr><td colSpan={10} className="td text-term-dim py-3">Nenhuma boleta no livro ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
