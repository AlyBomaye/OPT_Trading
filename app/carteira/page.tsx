"use client";

import { useMemo, useRef } from "react";
import { Database, FileJson, FileSpreadsheet, Trash2, Upload, XCircle } from "lucide-react";
import { currentPrice, useMarket } from "@/store/market";
import { netGreeks, realizedPnl, stressBook, unrealizedPnl, var95 } from "@/lib/portfolio";
import { skewInfo } from "@/lib/scanner";
import { useSnapshots, type IvSnapshot } from "@/lib/snapshots";
import { divsBeforeExpiry, effectiveDividends, useDividends } from "@/lib/dividends";
import { downloadText, fmtBRL, fmtDateBR, fmtNum, fmtPct, pnlColor } from "@/lib/format";

export default function CarteiraPage() {
  const { chain, selic, positions, closed, closePosition, removePosition, selectedExpiry } = useMarket();
  const { snapshots, importSnapshots } = useSnapshots();
  const divsByTicker = useDividends((st) => st.byTicker);
  const importRef = useRef<HTMLInputElement | null>(null);

  // WO-3: short call ITM em pagador de dividendo com ex-date antes do vencimento
  // (espelha a coluna R do Trade Log da planilha)
  const earlyExerciseAlerts = useMemo(
    () =>
      positions.flatMap((p) => {
        if (p.kind !== "OPTION" || p.type !== "CALL" || p.side !== -1 || !p.expiry || p.strike == null) return [];
        const divs = divsBeforeExpiry(effectiveDividends(divsByTicker, p.underlying), p.expiry);
        if (!divs.length) return [];
        const spotRef = chain && chain.ticker === p.underlying ? chain.spot : null;
        const isItm = spotRef != null && p.strike < spotRef;
        return isItm ? [{ pos: p, div: divs[0] }] : [];
      }),
    [positions, divsByTicker, chain]
  );

  const greeks = useMemo(() => netGreeks(positions, chain, selic), [positions, chain, selic]);
  const skew = chain && selectedExpiry ? skewInfo(chain, selectedExpiry) : null;
  const atmIv = skew?.ivCallAtm && skew?.ivPutAtm ? (skew.ivCallAtm + skew.ivPutAtm) / 2 : null;
  const risk = chain && positions.length ? var95(positions, chain, selic, atmIv) : null;
  const stress = chain && positions.length ? stressBook(positions, chain, selic) : [];

  const rows = positions.map((p) => {
    const cp = currentPrice(p, chain);
    return { p, cp, pnl: unrealizedPnl(p, cp) };
  });
  const totalUnreal = rows.reduce((a, r) => a + (r.pnl ?? 0), 0);
  const totalReal = closed.reduce((a, p) => a + (realizedPnl(p) ?? 0), 0);

  const exportCsv = () => {
    const header = "ativo;tipo;strike;venc;lado;qtd;preco_entrada;preco_atual;pnl";
    const lines = rows.map(({ p, cp, pnl }) =>
      [p.kind === "STOCK" ? p.underlying : p.opTicker, p.type ?? "ACAO", p.strike ?? "", p.expiry ?? "", p.side === 1 ? "C" : "V", p.qty, String(p.price).replace(".", ","), cp != null ? String(cp).replace(".", ",") : "", pnl != null ? String(pnl.toFixed(2)).replace(".", ",") : ""].join(";")
    );
    downloadText("carteira.csv", [header, ...lines].join("\n"), "text/csv");
  };

  const exportJson = () =>
    downloadText(
      "carteira.json",
      JSON.stringify({ exportedAt: new Date().toISOString(), greeks, var95: risk, positions: rows, closed }, null, 2),
      "application/json"
    );

  // WO-2: arquivo de snapshots de IV (export/import do "data moat")
  const exportIvHistory = () =>
    downloadText(
      "iv-snapshots.json",
      JSON.stringify({ exportedAt: new Date().toISOString(), snapshots }, null, 2),
      "application/json"
    );

  const onImportIvHistory = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { snapshots?: IvSnapshot[] } | IvSnapshot[];
      const list = Array.isArray(parsed) ? parsed : parsed.snapshots ?? [];
      const added = importSnapshots(list);
      alert(`${added} snapshot(s) importado(s).`);
    } catch {
      alert("Arquivo inválido — esperado JSON exportado pelo terminal.");
    }
  };

  return (
    <>
      {/* Gregas líquidas do book */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Kpi label="Δ em R$" value={fmtBRL(greeks.deltaCash, 0)} cls={pnlColor(greeks.deltaCash)} />
        <Kpi label="Γ líquido" value={fmtNum(greeks.gamma, 4)} />
        <Kpi label="Vega / +1%" value={fmtBRL(greeks.vegaPer1pct, 0)} cls={pnlColor(greeks.vegaPer1pct)} />
        <Kpi label="Θ / dia" value={fmtBRL(greeks.thetaPerDay, 0)} cls={pnlColor(greeks.thetaPerDay)} />
        <Kpi label="P&L aberto" value={fmtBRL(totalUnreal)} cls={pnlColor(totalUnreal)} />
        <Kpi label="P&L realizado" value={fmtBRL(totalReal)} cls={pnlColor(totalReal)} />
      </div>

      {/* WO-3: alerta de exercício antecipado */}
      {earlyExerciseAlerts.map(({ pos, div }) => (
        <div key={pos.id} className="panel px-3 py-2 text-xs text-term-gold flex items-center gap-2 border border-term-gold/40">
          ⚠ Exercício antecipado — {pos.opTicker}: call vendida ITM em {pos.underlying} com ex-div{" "}
          {div.exDate.slice(8, 10)}/{div.exDate.slice(5, 7)} ({div.type} R$ {div.amount.toFixed(2)}) antes do vencimento{" "}
          {pos.expiry ? fmtDateBR(pos.expiry) : ""} — risco de atribuição na véspera do ex-date.
        </div>
      ))}

      {/* Posições abertas */}
      <div className="panel">
        <div className="flex items-center px-3 pt-2">
          <span className="panel-title !p-0">Posições abertas</span>
          <div className="flex-1" />
          <button className="btn flex items-center gap-1" onClick={exportCsv}>
            <FileSpreadsheet size={12} /> CSV
          </button>
          <button className="btn flex items-center gap-1 ml-1" onClick={exportJson}>
            <FileJson size={12} /> JSON
          </button>
        </div>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-term-line">
                {["Ativo", "Tipo", "K", "Venc", "Lado", "Qtd", "Entrada", "Atual", "P&L", "Aberta em", ""].map((h) => (
                  <th key={h} className="th text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, cp, pnl }) => (
                <tr key={p.id} className="border-b border-term-line/40 hover:bg-term-panel2/50">
                  <td className="td font-semibold">{p.kind === "STOCK" ? `${p.underlying} (ação)` : p.opTicker}</td>
                  <td className="td text-right">{p.kind === "STOCK" ? "—" : p.type}</td>
                  <td className="td text-right">{p.strike != null ? fmtNum(p.strike) : "—"}</td>
                  <td className="td text-right">{p.expiry ? fmtDateBR(p.expiry) : "—"}</td>
                  <td className={`td text-right ${p.side === 1 ? "text-term-up" : "text-term-down"}`}>{p.side === 1 ? "C" : "V"}</td>
                  <td className="td text-right">{p.qty}</td>
                  <td className="td text-right">{fmtBRL(p.price)}</td>
                  <td className="td text-right">{fmtBRL(cp)}</td>
                  <td className={`td text-right font-semibold ${pnlColor(pnl ?? 0)}`}>{fmtBRL(pnl)}</td>
                  <td className="td text-right text-term-dim">{new Date(p.openedAt).toLocaleDateString("pt-BR")}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button
                      className="text-term-gold hover:opacity-70 mr-2"
                      title="Encerrar ao preço atual"
                      onClick={() => cp != null && closePosition(p.id, cp)}
                    >
                      <XCircle size={13} />
                    </button>
                    <button className="text-term-down hover:opacity-70" title="Excluir" onClick={() => removePosition(p.id)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={11} className="td text-term-dim py-3">
                    Sem posições — monte uma estrutura na Estratégia (3) e clique em “Abrir posição na carteira”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stress + VaR */}
      {stress.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            Stress do book (choque de spot, T+0) · VaR 95% 1d: <span className="text-term-down">{risk != null ? fmtBRL(risk, 0) : "—"}</span>
          </div>
          <div className="overflow-x-auto px-2 pb-2">
            <table className="text-xs font-mono">
              <thead>
                <tr>
                  {stress.map((c) => (
                    <th key={c.spotPct} className="th text-right">{fmtPct(c.spotPct, 0)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {stress.map((c) => (
                    <td key={c.spotPct} className={`td text-right font-semibold ${pnlColor(c.pnl)}`}>
                      {fmtBRL(c.pnl, 0)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WO-2: arquivo de snapshots de IV */}
      <div className="panel px-3 py-2 flex flex-wrap items-center gap-2 text-xxs text-term-dim">
        <Database size={12} className="text-term-cyan" />
        <span>
          Histórico IV: <span className="text-term-text font-semibold">{snapshots.length}</span> snapshot(s) ·{" "}
          {new Set(snapshots.map((s) => s.ticker)).size} ticker(s)
        </span>
        <div className="flex-1" />
        <button className="btn flex items-center gap-1" onClick={exportIvHistory}>
          <FileJson size={12} /> Exportar histórico IV
        </button>
        <button className="btn flex items-center gap-1" onClick={() => importRef.current?.click()}>
          <Upload size={12} /> Importar
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportIvHistory(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Encerradas */}
      {closed.length > 0 && (
        <div className="panel">
          <div className="panel-title">Histórico (realizadas)</div>
          <div className="overflow-x-auto px-2 pb-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-term-line">
                  {["Ativo", "Lado", "Qtd", "Entrada", "Saída", "P&L", "Encerrada em"].map((h) => (
                    <th key={h} className="th text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => {
                  const pnl = realizedPnl(p);
                  return (
                    <tr key={p.id} className="border-b border-term-line/40">
                      <td className="td">{p.kind === "STOCK" ? p.underlying : p.opTicker}</td>
                      <td className={`td text-right ${p.side === 1 ? "text-term-up" : "text-term-down"}`}>{p.side === 1 ? "C" : "V"}</td>
                      <td className="td text-right">{p.qty}</td>
                      <td className="td text-right">{fmtBRL(p.price)}</td>
                      <td className="td text-right">{fmtBRL(p.closePrice ?? null)}</td>
                      <td className={`td text-right font-semibold ${pnlColor(pnl ?? 0)}`}>{fmtBRL(pnl)}</td>
                      <td className="td text-right text-term-dim">{p.closedAt ? new Date(p.closedAt).toLocaleDateString("pt-BR") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="panel px-2 py-1.5">
      <div className="text-xxs text-term-dim uppercase tracking-wider">{label}</div>
      <div className={`font-mono font-semibold text-sm ${cls ?? ""}`}>{value}</div>
    </div>
  );
}
