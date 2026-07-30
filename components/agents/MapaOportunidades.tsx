"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ZAxis } from "recharts";
import { RefreshCw, ExternalLink, ArrowUpDown } from "lucide-react";
import clsx from "clsx";
import { UNIVERSE, type Sector } from "@/lib/universe";
import { useMarket } from "@/store/market";
import { useWatchlist, scanTicker, type WatchRowLike } from "@/lib/sector-dashboard";

const SECTOR_COLORS: Record<Sector, string> = {
  "Oil&Gas": "#ef4444",       // vermelho
  "Mining/Steel": "#f97316",  // laranja
  "Financials": "#3b82f6",    // azul
  "Retail": "#a855f7",        // roxo
  "Utilities": "#22c55e",     // verde
  "Industrials": "#eab308",   // amarelo
  "Airlines": "#ec4899",      // rosa
  "Education": "#06b6d4",     // ciano
  "Index": "#64748b",         // cinza
};

export function MapaOportunidades() {
  const router = useRouter();
  const setTicker = useMarket((st) => st.setTicker);
  const watchRows = useWatchlist((st) => st.rows);
  const setRow = useWatchlist((st) => st.setRow);
  const markRun = useWatchlist((st) => st.markRun);

  const [scanning, setScanning] = useState(false);
  const [sortField, setSortField] = useState<"ticker" | "skew" | "ivHv" | "chgPct">("skew");
  const [sortAsc, setSortAsc] = useState(false);

  // Mapeia universo de 20 ativos com dados da watchlist ou fallbacks
  const data = UNIVERSE.map((u) => {
    const row = watchRows[u.ticker];
    const skew = row?.skewRatio ?? null;
    const iv = row?.ivAtm ?? row?.ivCallAtm ?? null;
    const hv = row?.hv21 ?? null;
    const ivHv = iv != null && hv != null ? Number(((iv - hv) * 100).toFixed(1)) : null;
    const chg = row?.dayChgPct ?? row?.dayChg ?? null;

    return {
      ticker: u.ticker,
      sector: u.sector,
      name: u.name,
      skew: skew != null ? Number(skew.toFixed(2)) : null,
      ivHv: ivHv,
      chgPct: chg != null ? Number((chg * 100).toFixed(1)) : null,
      vol: 100, // tamanho base no scatter
      color: SECTOR_COLORS[u.sector] ?? "#94a3b8",
      hasData: skew != null || ivHv != null,
    };
  });

  const scatterPoints = data.filter((d) => d.skew != null && d.ivHv != null);

  const handleScanAll = async () => {
    setScanning(true);
    markRun();
    for (const u of UNIVERSE) {
      try {
        const res = await scanTicker(u.ticker);
        setRow(res);
      } catch {}
    }
    setScanning(false);
  };

  const handleSelectTicker = (t: string) => {
    setTicker(t);
    router.push("/chain");
  };

  // Ordenação da tabela
  const sortedData = [...data].sort((a, b) => {
    let valA: any = a[sortField];
    let valB: any = b[sortField];
    if (valA == null) return 1;
    if (valB == null) return -1;
    if (typeof valA === "string") return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    return sortAsc ? valA - valB : valB - valA;
  });

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-4 rounded flex flex-col space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800 pb-3">
        <div>
          <h4 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
            <span>Mapa de Oportunidades do Universo (20 Ativos B3)</span>
          </h4>
          <p className="text-xs text-neutral-500">
            Dispersão Skew P/C vs Spread IV-HV21 · Clique no ponto para navegar até a chain do ativo.
          </p>
        </div>
        <button
          onClick={handleScanAll}
          disabled={scanning}
          className="btn bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 font-mono rounded flex items-center shrink-0 self-start sm:self-auto"
        >
          <RefreshCw size={12} className={clsx("mr-1.5", scanning && "animate-spin")} />
          {scanning ? "Varrendo 20 ativos..." : "Varrer Universo"}
        </button>
      </div>

      {/* Gráfico de Dispersão */}
      {scatterPoints.length === 0 ? (
        <div className="bg-neutral-950 border border-neutral-800/80 p-8 rounded text-center flex flex-col items-center justify-center space-y-3">
          <div className="text-xs text-neutral-400 font-mono">
            Nenhuma varredura do universo registrada recentemente.
          </div>
          <button
            onClick={handleScanAll}
            disabled={scanning}
            className="btn bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-4 py-2 font-mono rounded flex items-center"
          >
            <RefreshCw size={14} className={clsx("mr-2", scanning && "animate-spin")} />
            Varrer Universo Agora (20 ativos B3)
          </button>
        </div>
      ) : (
        <div className="relative">
          {/* Legenda dos Quadrantes */}
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-neutral-500 mb-2">
            <div className="border border-neutral-800 p-1.5 rounded bg-neutral-950/40">
              <span className="text-red-400 font-bold">▲ Vol Rica + Puts Caras</span> (Skew ≥ 1.25, IV &gt; HV) → Put Ratio Backspread / Venda Vol
            </div>
            <div className="border border-neutral-800 p-1.5 rounded bg-neutral-950/40 text-right">
              <span className="text-green-400 font-bold">▲ Vol Rica + Calls Caras</span> (Skew ≤ 0.90, IV &gt; HV) → Call Ratio Backspread / Lançamento
            </div>
            <div className="border border-neutral-800 p-1.5 rounded bg-neutral-950/40">
              <span className="text-cyan-400 font-bold">▼ Vol Barata + Proteção Barata</span> (Skew ≥ 1.25, IV &lt; HV) → Compra de Put / Hedge
            </div>
            <div className="border border-neutral-800 p-1.5 rounded bg-neutral-950/40 text-right">
              <span className="text-purple-400 font-bold">▼ Vol Barata + Calls Baratas</span> (Skew ≤ 0.90, IV &lt; HV) → Trava de Alta / Pozinhos
            </div>
          </div>

          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                type="number"
                dataKey="skew"
                name="Skew P/C"
                domain={[0.7, 1.6]}
                tick={{ fontSize: 10, fill: "#999" }}
                unit="×"
                label={{ value: "Skew P/C (Assimetria Put/Call)", position: "bottom", offset: 5, fill: "#666", fontSize: 10 }}
              />
              <YAxis
                type="number"
                dataKey="ivHv"
                name="Spread IV-HV21"
                tick={{ fontSize: 10, fill: "#999" }}
                unit=" pp"
                label={{ value: "Spread IV-HV21 (pp)", angle: -90, position: "left", offset: 0, fill: "#666", fontSize: 10 }}
              />
              <ZAxis type="number" dataKey="vol" range={[60, 200]} />
              <ReferenceLine x={1.25} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Puts Caras (1.25)", fill: "#ef4444", fontSize: 9 }} />
              <ReferenceLine x={0.90} stroke="#22c55e" strokeDasharray="3 3" label={{ value: "Calls Caras (0.90)", fill: "#22c55e", fontSize: 9 }} />
              <ReferenceLine y={0} stroke="#666" strokeDasharray="2 2" />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 11 }}
                content={({ payload }) => {
                  if (!payload || !payload.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-neutral-950 border border-neutral-800 p-2 rounded text-xs">
                      <div className="font-mono font-bold text-cyan-400">{d.ticker} — {d.name}</div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-1">Setor: {d.sector}</div>
                      <div className="text-[10px] font-mono mt-1">
                        Skew P/C: <span className="text-white font-bold">{d.skew ?? "—"}</span>
                      </div>
                      <div className="text-[10px] font-mono">
                        Spread IV-HV21: <span className={clsx("font-bold", (d.ivHv ?? 0) > 0 ? "text-green-400" : "text-red-400")}>{d.ivHv != null ? `${d.ivHv} pp` : "—"}</span>
                      </div>
                      <div className="text-[9px] text-cyan-400 mt-1 font-mono italic">Clique para abrir Chain →</div>
                    </div>
                  );
                }}
              />
              {scatterPoints.map((pt, i) => (
                <Scatter
                  key={i}
                  data={[pt]}
                  fill={pt.color}
                  onClick={() => handleSelectTicker(pt.ticker)}
                  className="cursor-pointer hover:opacity-100 transition-opacity"
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>

          {/* Legenda de Cores por Setor */}
          <div className="flex flex-wrap gap-3 mt-2 justify-center text-[10px] font-mono text-neutral-400">
            {Object.entries(SECTOR_COLORS).map(([sec, color]) => (
              <span key={sec} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
                {sec}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tabela do Universo de 20 Nomes */}
      <div className="overflow-x-auto pt-2 border-t border-neutral-800">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-neutral-800 text-[10px] font-mono text-neutral-500 bg-neutral-950 sticky top-0 z-10">
              <th className="p-2 font-normal cursor-pointer" onClick={() => toggleSort("ticker")}>
                Ticker <ArrowUpDown size={10} className="inline ml-0.5" />
              </th>
              <th className="p-2 font-normal">Setor</th>
              <th className="p-2 font-normal text-right cursor-pointer" onClick={() => toggleSort("skew")}>
                Skew P/C <ArrowUpDown size={10} className="inline ml-0.5" />
              </th>
              <th className="p-2 font-normal text-right cursor-pointer" onClick={() => toggleSort("ivHv")}>
                Spread IV−HV21 <ArrowUpDown size={10} className="inline ml-0.5" />
              </th>
              <th className="p-2 font-normal text-right cursor-pointer" onClick={() => toggleSort("chgPct")}>
                Var. Dia <ArrowUpDown size={10} className="inline ml-0.5" />
              </th>
              <th className="p-2 font-normal text-center">Ação</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row) => (
              <tr key={row.ticker} className="border-b border-neutral-800/40 hover:bg-neutral-800/30 font-mono text-xs transition-colors">
                <td className="p-2 font-bold text-neutral-200">{row.ticker}</td>
                <td className="p-2 text-neutral-400 text-[11px] font-sans">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: row.color }} />
                  {row.sector}
                </td>
                <td className="p-2 text-right">
                  {row.skew != null ? (
                    <span className={clsx("font-bold", row.skew >= 1.25 ? "text-red-400" : row.skew <= 0.90 ? "text-green-400" : "text-neutral-300")}>
                      {row.skew.toFixed(2)}
                    </span>
                  ) : <span className="text-neutral-600">—</span>}
                </td>
                <td className="p-2 text-right">
                  {row.ivHv != null ? (
                    <span className={clsx("font-bold", row.ivHv > 0 ? "text-green-400" : "text-red-400")}>
                      {row.ivHv > 0 ? "+" : ""}{row.ivHv.toFixed(1)} pp
                    </span>
                  ) : <span className="text-neutral-600">—</span>}
                </td>
                <td className="p-2 text-right">
                  {row.chgPct != null ? (
                    <span className={row.chgPct >= 0 ? "text-green-400" : "text-red-400"}>
                      {row.chgPct >= 0 ? "+" : ""}{row.chgPct.toFixed(1)}%
                    </span>
                  ) : <span className="text-neutral-600">—</span>}
                </td>
                <td className="p-2 text-center">
                  <button
                    onClick={() => handleSelectTicker(row.ticker)}
                    className="text-xxs font-mono text-cyan-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    Chain <ExternalLink size={10} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
