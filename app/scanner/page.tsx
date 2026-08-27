"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMarket } from "@/store/market";
import { DEFAULT_POZINHO_FILTERS, scanPozinhos, type PozinhoFilters } from "@/lib/scanner";
import { allocatedCapital, journalStats } from "@/lib/portfolio";
import { legFromOption } from "@/lib/strategies";
import { sectorOf } from "@/lib/universe";
import { fmtBRL, fmtCompact, fmtDateBR, fmtNum, fmtPct } from "@/lib/format";
import { AgentPanel } from "@/components/AgentPanel";
import { TruthBar } from "@/components/TruthBar";

export default function ScannerPage() {
  const { chain, ticker, selic, selectedExpiry, addLeg, positions, closed, capitalTotal } = useMarket();
  const router = useRouter();
  const [f, setF] = useState<PozinhoFilters>(DEFAULT_POZINHO_FILTERS);

  const rows = useMemo(() => (chain ? scanPozinhos(chain, f) : []), [chain, f]);

  // WO-11: subtotal por setor com checagem de orçamento ¼-Kelly (planilha)
  const capitalLivre = capitalTotal - allocatedCapital(positions);
  const journal = useMemo(() => journalStats(closed), [closed]);
  // Fração de Kelly: realizada (journal ≥ 20 trades) ou 10% conservador sem histórico
  const kellyFrac = journal != null && journal.n >= 20 && journal.realizedKelly != null ? Math.max(journal.realizedKelly, 0) : 0.1;
  const orcamentoSetor = (kellyFrac / 4) * Math.max(capitalLivre, 0);
  const porSetor = useMemo(() => {
    const acc = new Map<string, { n: number; premio: number }>();
    for (const { opt: o } of rows.slice(0, 40)) {
      const s = sectorOf(o.underlying) ?? "—";
      const cur = acc.get(s) ?? { n: 0, premio: 0 };
      cur.n++;
      cur.premio += o.last ?? 0;
      acc.set(s, cur);
    }
    return Array.from(acc.entries()).sort((a, b) => b[1].premio - a[1].premio);
  }, [rows]);

  const set = (k: keyof PozinhoFilters) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((old) => ({ ...old, [k]: Number(e.target.value) || 0 }));

  return (
    <>
      <TruthBar />
      <AgentPanel
        agentId="scanner"
        title="Agente Especialista de Convexidade & Scanner"
        agentContext={{
          ticker,
          selic,
          chain,
          selectedExpiry,
        }}
      />
      <div className="panel">
        <div className="panel-title">Scanner de Pozinhos — OTM barato com máxima convexidade (Δ/R$)</div>

        {/* WO-44: o manual dedica um capítulo ao Pozinho para DESENCORAJÁ-LO. A tela ranqueava sem
            dizer isso. A ressalva é do próprio método, com o número que ele dá. */}
        <div className="mx-3 mt-3 text-xxs text-term-gold bg-term-gold/10 border border-term-gold/30 rounded px-2.5 py-2 leading-relaxed">
          <b>O método desaconselha esta estratégia.</b> Entre 95% e 98% dessas opções viram pó no
          vencimento. O manual a inclui para que você reconheça a narrativa quando alguém tentar
          vendê-la — e entenda por que a matemática agregada é desfavorável, mesmo com casos virais
          de ganho extremo. Se for operar, trate como bilhete de loteria: valor que não faz falta.
        </div>
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

      <div id="pozinhos-tabela" className="panel overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
            <tr className="border-b border-term-line">
              {["Opção", "Setor", "Tipo", "Venc", "DU", "Strike", "Dist %", "Prêmio", "Δ", "IV", "Δ/R$ ▼", "Dist σ", "% até BE", "Neg", "Vol fin", ""].map((h) => (
                <th key={h} className="th text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map(({ opt: o, convexity, distSigma, pctToBE }) => (
              <tr key={o.opTicker} className="border-b border-term-line/40 hover:bg-term-panel2/50">
                <td className="td font-semibold">{o.opTicker}</td>
                <td className="td text-right text-term-dim text-xxs">{sectorOf(o.underlying) ?? "—"}</td>
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
                <td colSpan={16} className="td text-term-dim py-4">
                  Nenhum candidato com os filtros atuais — afrouxe prêmio/distância ou reduza o volume mínimo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* WO-11: alocação por setor vs. orçamento ¼-Kelly — evita concentração
          em vol barata correlacionada (ex.: três siderúrgicas de uma vez) */}
      {porSetor.length > 0 && (
        <div id="alocacao-setor" className="panel">
          <div className="panel-title">
            Alocação por setor (1 un. por candidato exibido) · orçamento ¼-Kelly por setor: {fmtBRL(orcamentoSetor, 0)}
            {journal == null || journal.n < 20 ? " (sem journal ≥ 20 trades: fração Kelly conservadora de 10%)" : " (Kelly realizado do journal)"}
          </div>
          <div className="px-3 pb-2 overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr className="border-b border-term-line">
                  {["Setor", "Candidatos", "Σ prêmio", "Orçamento"].map((h) => (
                    <th key={h} className="th text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {porSetor.map(([s, v]) => {
                  const excede = v.premio > orcamentoSetor;
                  return (
                    <tr key={s} className="border-b border-term-line/40">
                      <td className="td">{s}</td>
                      <td className="td text-right">{v.n}</td>
                      <td className={`td text-right font-semibold ${excede ? "text-term-down" : ""}`}>{fmtBRL(v.premio)}</td>
                      <td className="td text-right">{excede ? <span className="text-term-down font-semibold">⚠ &gt; ¼-Kelly</span> : "ok"}</td>
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

function Filter({ label, v, step, on }: { label: string; v: number; step: number; on: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      {label}
      <input type="number" value={v} step={step} onChange={on} className="cell-input !w-20" />
    </label>
  );
}
