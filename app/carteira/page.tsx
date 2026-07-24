"use client";

import { useMemo, useRef, useState } from "react";
import { Database, FileJson, FileSpreadsheet, RefreshCw, Trash2, Upload, XCircle } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { markInfo, useMarket } from "@/store/market";
import {
  allocatedCapital,
  equityCurve,
  journalStats,
  netGreeks,
  realizedPnl,
  stressBook,
  unrealizedPnl,
  varGrid,
} from "@/lib/portfolio";
import { skewInfo } from "@/lib/scanner";
import { useSnapshots, type IvSnapshot } from "@/lib/snapshots";
import { divsBeforeExpiry, effectiveDividends, useDividends } from "@/lib/dividends";
import { downloadText, fmtBRL, fmtDateBR, fmtNum, fmtPct, pnlColor } from "@/lib/format";

export default function CarteiraPage() {
  const {
    chain,
    chainCache,
    selic,
    positions,
    closed,
    closePosition,
    removePosition,
    updatePosition,
    selectedExpiry,
    refresh,
    capitalTotal,
    setCapitalTotal,
  } = useMarket();
  // WO-4: progresso do "Reavaliar tudo"
  const [reval, setReval] = useState<{ done: number; total: number; failed: string[] } | null>(null);
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
  const risk = chain && positions.length ? varGrid(positions, chain, selic, atmIv) : null;
  const stress = chain && positions.length ? stressBook(positions, chain, selic) : [];

  const rows = positions.map((p) => {
    const mark = markInfo(p, chainCache);
    return { p, cp: mark.price, mark, pnl: unrealizedPnl(p, mark.price) };
  });

  // WO-4: reavalia sequencialmente o chain de cada ativo distinto do book
  const revalAll = async () => {
    const tickers = Array.from(new Set(positions.map((p) => p.underlying)));
    if (!tickers.length) return;
    setReval({ done: 0, total: tickers.length, failed: [] });
    const failed: string[] = [];
    for (let i = 0; i < tickers.length; i++) {
      try {
        await refresh(tickers[i]);
      } catch {
        failed.push(tickers[i]);
      }
      setReval({ done: i + 1, total: tickers.length, failed: [...failed] });
    }
    setTimeout(() => setReval(null), 4000);
  };
  const totalUnreal = rows.reduce((a, r) => a + (r.pnl ?? 0), 0);
  const totalReal = closed.reduce((a, p) => a + (realizedPnl(p) ?? 0), 0);

  // WO-11: capital, journal e curva de patrimônio (semântica da planilha)
  const alocado = useMemo(() => allocatedCapital(positions), [positions]);
  const caixaLivre = capitalTotal - alocado;
  const journal = useMemo(() => journalStats(closed), [closed]);
  const curve = useMemo(() => equityCurve(closed, capitalTotal), [closed, capitalTotal]);
  const noEdge = journal != null && journal.n >= 20 && (journal.realizedKelly ?? 0) <= 0;

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
      JSON.stringify({ exportedAt: new Date().toISOString(), greeks, var95: risk?.var95 ?? null, es: risk?.es ?? null, positions: rows, closed }, null, 2),
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
      {/* WO-11: capital & desempenho (Dashboard da planilha) */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <div className="panel px-2 py-1.5">
          <div className="text-xxs text-term-dim uppercase tracking-wider">Capital total (R$)</div>
          <input
            type="number"
            step="1000"
            value={capitalTotal}
            onChange={(e) => setCapitalTotal(Number(e.target.value) || 0)}
            className="cell-input !w-full font-mono font-semibold"
          />
        </div>
        <Kpi label="Alocado (margem 20% K)" value={fmtBRL(alocado, 0)} />
        <Kpi label="Caixa livre" value={fmtBRL(caixaLivre, 0)} cls={caixaLivre < 0 ? "text-term-down" : "text-term-up"} />
        <Kpi label="Win rate (encerradas)" value={journal ? `${fmtPct(journal.winRate)} (${journal.wins}/${journal.n})` : "—"} />
        <Kpi label="Payoff ratio" value={journal?.payoffRatio != null ? fmtNum(journal.payoffRatio, 2) : "—"} />
        <Kpi
          label="Kelly realizado"
          value={journal?.realizedKelly != null ? fmtPct(journal.realizedKelly) : journal ? "n/d" : "—"}
          cls={noEdge ? "text-term-down" : journal?.realizedKelly != null && journal.realizedKelly > 0 ? "text-term-up" : ""}
        />
      </div>

      {noEdge && (
        <div className="panel px-3 py-2 text-xs font-semibold text-term-down border border-term-down/40">
          NO EDGE — DO NOT TRADE: com {journal?.n} trades encerrados, o Kelly realizado é ≤ 0. O journal não comprova a
          vantagem assumida — reduza tamanho ou pare até rever o processo.
        </div>
      )}

      {closed.length > 0 && (
        <div className="panel">
          <div className="panel-title">Curva de patrimônio — P&L realizado acumulado (semente: capital total)</div>
          <div className="h-48 px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                <CartesianGrid stroke="#232a38" strokeDasharray="2 4" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7689" }} minTickGap={40} />
                <YAxis tick={{ fontSize: 9, fill: "#6b7689" }} width={64} domain={["auto", "auto"]} tickFormatter={(v: number) => fmtBRL(v, 0)} />
                <Tooltip
                  contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                  formatter={(v: number) => fmtBRL(v)}
                />
                <Line type="stepAfter" dataKey="equity" name="Patrimônio" stroke="#22d3ee" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

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
          <button
            className="btn flex items-center gap-1 mr-1"
            onClick={() => void revalAll()}
            disabled={reval != null && reval.done < reval.total}
            title="Atualiza o chain de cada ativo do book para reprecificar todas as posições"
          >
            <RefreshCw size={12} className={reval != null && reval.done < reval.total ? "animate-spin" : ""} />
            {reval ? `Reavaliando ${reval.done}/${reval.total}${reval.failed.length ? ` · falhou: ${reval.failed.join(",")}` : ""}` : "Reavaliar tudo"}
          </button>
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
                {["Ativo", "Tipo", "K", "Venc", "Lado", "Qtd", "Entrada", "Atual", "P&L", "Taxas", "Notas", "Aberta em", ""].map((h) => (
                  <th key={h} className="th text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, cp, mark, pnl }) => (
                <tr key={p.id} className="border-b border-term-line/40 hover:bg-term-panel2/50">
                  <td
                    className="td font-semibold"
                    title={
                      p.entryGreeks
                        ? `Gregas na abertura (por unidade): Δ ${fmtNum(p.entryGreeks.delta, 3)} · vega ${fmtNum(p.entryGreeks.vega, 4)} · θ ${fmtNum(p.entryGreeks.theta, 4)}`
                        : "Sem snapshot de gregas na abertura"
                    }
                  >
                    {p.kind === "STOCK" ? `${p.underlying} (ação)` : p.opTicker}
                  </td>
                  <td className="td text-right">{p.kind === "STOCK" ? "—" : p.type}</td>
                  <td className="td text-right">{p.strike != null ? fmtNum(p.strike) : "—"}</td>
                  <td className="td text-right">{p.expiry ? fmtDateBR(p.expiry) : "—"}</td>
                  <td className={`td text-right ${p.side === 1 ? "text-term-up" : "text-term-down"}`}>{p.side === 1 ? "C" : "V"}</td>
                  <td className="td text-right">{p.qty}</td>
                  <td className="td text-right">{fmtBRL(p.price)}</td>
                  <td className="td text-right">
                    {fmtBRL(cp)}
                    {mark.stale && cp != null && (
                      <span
                        className="tag bg-term-gold/15 text-term-gold ml-1"
                        title={`Última marcação conhecida${mark.ageMin != null ? ` há ${mark.ageMin} min` : ""} — clique em Reavaliar tudo`}
                      >
                        STALE{mark.ageMin != null ? ` ${mark.ageMin}m` : ""}
                      </span>
                    )}
                  </td>
                  <td className={`td text-right font-semibold ${pnlColor(pnl ?? 0)}`}>{fmtBRL(pnl)}</td>
                  <td className="td text-right">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={p.fees ?? 0}
                      onChange={(e) => updatePosition(p.id, { fees: Number(e.target.value) || 0 })}
                      className="cell-input !w-16"
                      aria-label="Taxas da posição"
                    />
                  </td>
                  <td className="td text-right">
                    <input
                      type="text"
                      value={p.notes ?? ""}
                      placeholder="tese…"
                      onChange={(e) => updatePosition(p.id, { notes: e.target.value })}
                      className="cell-input !w-24 !text-left"
                      aria-label="Notas da posição"
                    />
                  </td>
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
                  <td colSpan={13} className="td text-term-dim py-3">
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
          <div
            className="panel-title"
            title="VaR por reavaliação em grade 3×3: spot {−1,645σ, 0, +1,645σ} × vol {−20%, 0, +30%}, com theta carry (T+1). ES = média dos 2 piores cenários."
          >
            Stress do book (choque de spot, T+0) · VaR 95% 1d (spot×vol):{" "}
            <span className="text-term-down">{risk != null ? fmtBRL(risk.var95, 0) : "—"}</span> · ES proxy:{" "}
            <span className="text-term-down">{risk != null ? fmtBRL(risk.es, 0) : "—"}</span>
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
