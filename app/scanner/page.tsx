"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMarket } from "@/store/market";
import { DEFAULT_POZINHO_FILTERS, scanPozinhos, type PozinhoFilters } from "@/lib/scanner";
import { legFromOption } from "@/lib/strategies";
import { fmtBRL, fmtCompact, fmtDateBR, fmtNum, fmtPct } from "@/lib/format";

export default function ScannerPage() {
  const { chain, addLeg } = useMarket();
  const router = useRouter();
  const [f, setF] = useState<PozinhoFilters>(DEFAULT_POZINHO_FILTERS);

  const rows = useMemo(() => (chain ? scanPozinhos(chain, f) : []), [chain, f]);

  const set = (k: keyof PozinhoFilters) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((old) => ({ ...old, [k]: Number(e.target.value) || 0 }));

  return (
    <>
      <div className="panel">
        <div className="panel-title">Scanner de Pozinhos — OTM barato com máxima convexidade (Δ/R$)</div>
        <div className="flex flex-wrap gap-3 px-3 pb-2 text-xxs text-term-dim items-end">
          <Filter label="Prêmio mín" v={f.premiumMin} step={0.01} on={set("premiumMin")} />
          <Filter label="Prêmio máx" v={f.premiumMax} step={0.01} on={set("premiumMax")} />
          <Filter label="Dist mín %" v={f.distMin * 100} step={1} on={(e) => setF((o) => ({ ...o, distMin: Number(e.target.value) / 100 || 0 }))} />
          <Filter label="Dist máx %" v={f.distMax * 100} step={1} on={(e) => setF((o) => ({ ...o, distMax: Number(e.target.value) / 100 || 0 }))} />
          <Filter label="Vol.fin mín R$" v={f.volumeMin} step={500} on={set("volumeMin")} />
          <Filter label="DU mín" v={f.duMin} step={1} on={set("duMin")} />
          <Filter label="DU máx" v={f.duMax} step={1} on={set("duMax")} />
          <span className="pb-1">
            {rows.length} candidato(s) · regra: bilhete pequeno — trate pozinho como loteria, não como posição.
          </span>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-term-line">
              {["Opção", "Tipo", "Venc", "DU", "Strike", "Dist %", "Prêmio", "Δ", "IV", "Δ/R$ ▼", "Dist σ", "% até BE", "Neg", "Vol fin", ""].map((h) => (
                <th key={h} className="th text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map(({ opt: o, convexity, distSigma, pctToBE }) => (
              <tr key={o.opTicker} className="border-b border-term-line/40 hover:bg-term-panel2/50">
                <td className="td font-semibold">{o.opTicker}</td>
                <td className={`td text-right ${o.type === "CALL" ? "text-term-up" : "text-term-down"}`}>{o.type}</td>
                <td className="td text-right">{fmtDateBR(o.expiry)}</td>
                <td className="td text-right">{o.du}</td>
                <td className="td text-right">{fmtNum(o.strike)}</td>
                <td className="td text-right">{fmtPct(o.distStrikePct)}</td>
                <td className="td text-right font-semibold">{fmtBRL(o.last)}</td>
                <td className="td text-right text-term-cyan">{fmtNum(o.delta, 3)}</td>
                <td className="td text-right text-term-gold">{fmtPct(o.iv)}</td>
                <td className="td text-right font-bold text-term-cyan">{fmtNum(convexity, 1)}</td>
                <td className="td text-right">{distSigma != null ? `${fmtNum(distSigma, 2)}σ` : "—"}</td>
                <td className="td text-right">{fmtPct(pctToBE)}</td>
                <td className="td text-right text-term-dim">{fmtCompact(o.trades)}</td>
                <td className="td text-right text-term-dim">{fmtCompact(o.volumeFin)}</td>
                <td className="td text-right">
                  <button
                    className="tag bg-term-up/15 text-term-up hover:bg-term-up/30"
                    onClick={() => {
                      addLeg(legFromOption(o, 1));
                      router.push("/estrategia");
                    }}
                  >
                    Comprar →
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={15} className="td text-term-dim py-4">
                  Nenhum candidato com os filtros atuais — afrouxe prêmio/distância ou reduza o volume mínimo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Filter({ label, v, step, on }: { label: string; v: number; step: number; on: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      {label}
      <input type="number" value={v} step={step} onChange={on} className="cell-input !w-20" />
    </label>
  );
}
