"use client";

/**
 * WO-56 — reconciliação com a nota de corretagem: cole o texto da nota, veja o que casa com o
 * livro, o que falta, o que sobra e quanto os custos estimados erraram. Nada é gravado: a
 * correção é uma boleta de ajuste, decidida pelo trader.
 */

import { useMemo, useState } from "react";
import { FileCheck2, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { parseNotaSinacor, reconciliarNota, type BoletaParaReconciliar } from "@/lib/nota-corretagem";
import { usePersistedState } from "@/lib/use-persisted-state";
import { fmtBRL, fmtDateBR } from "@/lib/format";

export function ReconciliacaoNota() {
  const livro = useMarket((st) => st.livro);
  const [aberto, setAberto] = usePersistedState<boolean>("carteira-nota-open", false);
  const [texto, setTexto] = useState("");

  const boletas: BoletaParaReconciliar[] = useMemo(
    () =>
      (livro.boletas ?? []).map((b: any) => ({
        id: b.id,
        tipo: b.tipo,
        executadoEm: b.executadoEm,
        ticker: b.ticker,
        opTicker: b.opTicker ?? null,
        kind: b.kind,
        lado: b.lado ?? null,
        quantidade: b.quantidade,
        preco: b.preco,
        custosTotal: b.custosTotal ?? 0,
      })),
    [livro.boletas]
  );

  const resultado = useMemo(() => {
    if (texto.trim().length < 20) return null;
    const nota = parseNotaSinacor(texto);
    return { nota, rec: reconciliarNota(nota, boletas) };
  }, [texto, boletas]);

  return (
    <div id="nota" className="panel">
      <div onClick={() => setAberto(!aberto)} className="panel-title flex items-center justify-between cursor-pointer select-none">
        <span className="flex items-center gap-2">
          {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileCheck2 size={14} className="text-term-cyan" />
          <span className="font-bold">Reconciliação com a nota de corretagem</span>
          <span className="tag bg-term-panel2 text-term-dim">cole o texto da nota (padrão Sinacor, XP) — nada é gravado</span>
        </span>
        {resultado && <span className="text-xxs text-term-cyan">{resultado.rec.resumo}</span>}
      </div>
      {aberto && (
        <div className="px-3 pb-3 space-y-2 text-xxs">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={"Abra o PDF da nota, selecione tudo (Ctrl+A), copie e cole aqui. Precisa das linhas '1-BOVESPA C/V ...' dos negócios, do 'Total Custos / Despesas' e da 'Data pregão'."}
            className="w-full h-32 bg-term-panel2 border border-term-line rounded p-2 font-mono text-xxs outline-none focus:border-term-cyan"
          />
          {resultado && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3 text-term-dim">
                <span>pregão: <b className="text-term-text">{resultado.nota.dataPregao ? fmtDateBR(resultado.nota.dataPregao) : "não lido"}</b></span>
                <span>negócios na nota: <b className="text-term-text">{resultado.nota.negocios.length}</b></span>
                <span>custos cobrados: <b className="text-term-text">{resultado.nota.custos.total != null ? fmtBRL(resultado.nota.custos.total) : "—"}</b></span>
                <span>líquido: <b className="text-term-text">{resultado.nota.liquido != null ? fmtBRL(resultado.nota.liquido) : "—"}</b></span>
              </div>
              {resultado.nota.avisos.map((a, i) => <div key={i} className="text-term-gold">⚠ {a}</div>)}
              <table className="w-full text-xxs font-mono">
                <thead className="border-b border-term-line">
                  <tr>{["Nota", "Qtd", "Preço", "Valor", "Boleta", "Situação"].map((h) => <th key={h} className="th text-right first:text-left">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {resultado.rec.casados.map((c, i) => (
                    <tr key={`c${i}`} className="border-b border-term-line/40">
                      <td className="td">{c.negocio.cv} {c.negocio.codigo}</td>
                      <td className="td text-right">{c.negocio.quantidade}</td>
                      <td className="td text-right">{fmtBRL(c.negocio.preco)}</td>
                      <td className="td text-right">{fmtBRL(c.negocio.valor)}</td>
                      <td className="td text-right text-term-dim">#{c.boleta?.id} · custos est. {fmtBRL(c.boleta?.custosTotal ?? 0)}</td>
                      <td className={clsx("td text-right", c.divergencias.length ? "text-term-gold" : "text-term-up")}>{c.divergencias.length ? c.divergencias.join("; ") : "casada"}</td>
                    </tr>
                  ))}
                  {resultado.rec.faltamBoletar.map((n, i) => (
                    <tr key={`f${i}`} className="border-b border-term-line/40">
                      <td className="td">{n.cv} {n.codigo}</td>
                      <td className="td text-right">{n.quantidade}</td>
                      <td className="td text-right">{fmtBRL(n.preco)}</td>
                      <td className="td text-right">{fmtBRL(n.valor)}</td>
                      <td className="td text-right text-term-dim">—</td>
                      <td className="td text-right text-term-down">na nota, sem boleta — bolete (B)</td>
                    </tr>
                  ))}
                  {resultado.rec.boletasSemNota.map((b) => (
                    <tr key={`b${b.id}`} className="border-b border-term-line/40">
                      <td className="td text-term-dim">{b.lado === 1 ? "C" : "V"} {b.kind === "STOCK" ? b.ticker : b.opTicker}</td>
                      <td className="td text-right text-term-dim">{b.quantidade}</td>
                      <td className="td text-right text-term-dim">{fmtBRL(b.preco)}</td>
                      <td className="td text-right text-term-dim">{fmtBRL(b.preco * b.quantidade)}</td>
                      <td className="td text-right text-term-dim">#{b.id}</td>
                      <td className="td text-right text-term-gold">boleta sem nota — estorne (ajuste) se não executou</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {resultado.rec.diferencaCustos != null && (
                <div className={clsx("rounded border px-2 py-1.5", Math.abs(resultado.rec.diferencaCustos) < 0.05 ? "border-term-up/40 text-term-up" : "border-term-gold/40 text-term-gold")}>
                  Custos: o livro estimou {fmtBRL(resultado.rec.custosEstimados)} e a nota cobrou {fmtBRL(resultado.rec.custosCobrados!)} ({resultado.rec.diferencaCustos >= 0 ? "+" : ""}{fmtBRL(resultado.rec.diferencaCustos)}).
                  {Math.abs(resultado.rec.diferencaCustos) >= 0.05 && resultado.rec.distribuicao.length > 0 && (
                    <> Distribuição sugerida por boleta (proporcional ao financeiro): {resultado.rec.distribuicao.map((d) => `#${d.boletaId} ${d.ajuste >= 0 ? "+" : ""}${fmtBRL(d.ajuste)}`).join(", ")} — registre como boletas de ajuste, ou ajuste a tabela de custos se o erro for sistemático.</>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
