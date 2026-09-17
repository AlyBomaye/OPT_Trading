"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { legFromOption } from "@/lib/strategies";
import { divsBeforeExpiry, effectiveDividends, useDividends } from "@/lib/dividends";
import { fmtCompact, fmtDateBR, fmtNum, fmtPct } from "@/lib/format";
import type { OptionQuote } from "@/lib/types";

export function OptionChain() {
  const { chain, selectedExpiry, setSelectedExpiry, addLeg, loading } = useMarket();
  const byTicker = useDividends((st) => st.byTicker);
  const router = useRouter();
  const [onlyLiquid, setOnlyLiquid] = useState(true);
  const [bandPct, setBandPct] = useState(20);

  const rows = useMemo(() => {
    if (!chain || !selectedExpiry) return [];
    const within = chain.options.filter(
      (o) =>
        o.expiry === selectedExpiry &&
        Math.abs(o.strike / chain.spot - 1) <= bandPct / 100 &&
        (!onlyLiquid || ((o.trades ?? 0) > 0 && o.last != null))
    );
    const strikes = Array.from(new Set(within.map((o) => o.strike))).sort((a, b) => a - b);
    return strikes.map((k) => ({
      strike: k,
      call: within.find((o) => o.strike === k && o.type === "CALL") ?? null,
      put: within.find((o) => o.strike === k && o.type === "PUT") ?? null,
    }));
  }, [chain, selectedExpiry, onlyLiquid, bandPct]);

  if (!chain) {
    return <div className="panel p-6 text-term-dim">{loading ? "Carregando chain..." : "Sem dados — verifique o ticker."}</div>;
  }

  const add = (o: OptionQuote, side: 1 | -1) => {
    addLeg(legFromOption(o, side));
    router.push("/estrategia");
  };

  return (
    <div className="panel">
      <div className="flex items-center gap-2 px-3 pt-2 flex-wrap">
        <span className="panel-title !p-0">Option Chain — {chain.ticker}</span>
        <div className="flex-1" />
        <label className="text-xxs text-term-dim flex items-center gap-1">
          Banda ±
          <input
            type="number"
            value={bandPct}
            min={5}
            max={60}
            onChange={(e) => setBandPct(Number(e.target.value) || 20)}
            className="cell-input !w-12"
          />
          %
        </label>
        <label className="text-xxs text-term-dim flex items-center gap-1">
          <input type="checkbox" checked={onlyLiquid} onChange={(e) => setOnlyLiquid(e.target.checked)} />
          só com negócios
        </label>
      </div>

      {/* Tabs de vencimento */}
      <div className="flex gap-1 px-3 py-2 flex-wrap">
        {chain.expiries.map((e) => {
          // WO-3: proventos com ex-date antes deste vencimento → chip DIV
          const divs = divsBeforeExpiry(effectiveDividends(byTicker, chain.ticker), e.date);
          return (
            <button
              key={e.date}
              onClick={() => setSelectedExpiry(e.date)}
              className={clsx(
                "tag border",
                e.date === selectedExpiry
                  ? "bg-term-cyan/15 border-term-cyan/60 text-term-cyan"
                  : "bg-term-panel2 border-term-line text-term-dim hover:text-term-text"
              )}
              title={`${e.du} du · ${e.dte} dias corridos`}
            >
              {e.label}
              {e.isMonthly ? "·M" : e.weekCode ? `·${e.weekCode}` : ""} <span className="opacity-60">{e.du}du</span>
              {divs.map((d) => (
                <span
                  key={d.exDate}
                  className="tag bg-term-gold/15 text-term-gold ml-1"
                  title={`${d.type} R$ ${d.amount.toFixed(2)} — ex-date ${d.exDate.slice(8, 10)}/${d.exDate.slice(5, 7)}; pricing usa S′ = S − PV`}
                >
                  DIV {d.exDate.slice(8, 10)}/{d.exDate.slice(5, 7)}
                </span>
              ))}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-t border-term-line">
          <thead>
            <tr className="bg-term-panel2/60">
              <th className="th text-center" colSpan={8}>CALLS</th>
              <th className="th text-center bg-term-panel2">STRIKE</th>
              <th className="th text-center" colSpan={8}>PUTS</th>
            </tr>
            <tr className="border-b border-term-line">
              {["Ticker", "Bid/Ask", "Últ", "IV", "Δ", "Γ", "Θ", "Neg/Vol"].map((h) => (
                <th key={`c-${h}`} className="th text-right" title={h === "Bid/Ask" ? "Melhor oferta de compra / de venda — ao vivo (MT5) ou de fechamento (COTAHIST)" : undefined}>{h}</th>
              ))}
              <th className="th text-center bg-term-panel2">K</th>
              {["Neg/Vol", "Θ", "Γ", "Δ", "IV", "Últ", "Bid/Ask", "Ticker"].map((h) => (
                <th key={`p-${h}`} className="th text-left" title={h === "Bid/Ask" ? "Melhor oferta de compra / de venda — ao vivo (MT5) ou de fechamento (COTAHIST)" : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ strike, call, put }) => {
              const atm = Math.abs(strike / chain.spot - 1) < 0.015;
              return (
                <tr key={strike} className={clsx("border-b border-term-line/40 hover:bg-term-panel2/50", atm && "bg-term-cyan/5")}>
                  <CallCells o={call} spot={chain.spot} onAdd={add} />
                  <td className={clsx("td text-center font-bold bg-term-panel2/70", atm ? "text-term-cyan" : "text-term-text")}>
                    {fmtNum(strike)}
                  </td>
                  <PutCells o={put} spot={chain.spot} onAdd={add} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 text-xxs text-term-dim">
        Clique <span className="text-term-up">C</span>/<span className="text-term-down">V</span> para comprar/vender a perna no
        Strategy Builder. Fundo verde = ITM.
        {(() => {
          // WO-56/WO-61: quantas séries têm bid e ask — ao vivo (MT5, `tickAt`) ou de fechamento (COTAHIST).
          const comOferta = chain.options.filter((o) => o.bid != null && o.ask != null);
          const aoVivo = comOferta.filter((o) => o.tickAt).length;
          const data = comOferta.find((o) => o.ofertasData)?.ofertasData ?? null;
          if (aoVivo > 0) {
            return (
              <span className="ml-2 text-term-green" title="Book ao vivo pela ponte MT5 (terminal da corretora). Séries com as duas ofertas e spread razoável são marcadas pelo mid.">
                · book ao vivo (MT5): {aoVivo} de {chain.options.length} séries com bid e ask{comOferta.length > aoVivo ? ` (+${comOferta.length - aoVivo} de fechamento)` : ""}
              </span>
            );
          }
          return comOferta.length > 0 ? (
            <span className="ml-2 text-term-cyan" title="Melhor oferta de compra e de venda no fechamento, do arquivo diário da B3. Séries com as duas ofertas e spread razoável são marcadas pelo mid na Carteira.">
              · ofertas de fechamento{data ? ` (${data})` : ""}: {comOferta.length} de {chain.options.length} séries com bid e ask
            </span>
          ) : (
            <span className="ml-2">· sem book: ponte MT5 fora e COTAHIST da B3 indisponível para a data</span>
          );
        })()}
      </div>
    </div>
  );
}

function itm(o: OptionQuote, spot: number): boolean {
  return o.type === "CALL" ? o.strike < spot : o.strike > spot;
}

function TradeBtns({ o, onAdd }: { o: OptionQuote; onAdd: (o: OptionQuote, s: 1 | -1) => void }) {
  return (
    <span className="inline-flex gap-0.5 ml-1">
      <button onClick={() => onAdd(o, 1)} className="tag bg-term-up/15 text-term-up hover:bg-term-up/30" title="Comprar">
        C
      </button>
      <button onClick={() => onAdd(o, -1)} className="tag bg-term-down/15 text-term-down hover:bg-term-down/30" title="Vender">
        V
      </button>
    </span>
  );
}

/**
 * WO-30 §2.4 — idade do prêmio visível na própria célula, não só no tooltip.
 * Sessão corrente não recebe marca (é o normal); D-1 recebe chip discreto;
 * dois pregões ou mais recebem a data em destaque, porque aquele preço não existe mais.
 */
function AgeChip({ o }: { o: OptionQuote }) {
  const age = o.tradeAgeSessions ?? null;
  if (o.last == null || age == null || age <= 0) return null;
  if (age >= 90) return null; // sem negócio algum: o prêmio nulo já diz isso
  const critico = age >= 2;
  return (
    <span
      className={clsx(
        "tag ml-1 text-[9px]",
        critico ? "bg-term-gold/20 text-term-gold" : "bg-term-line/40 text-term-dim"
      )}
      title={`Último negócio em ${o.lastTradeAt ? fmtDateBR(o.lastTradeAt) : "data desconhecida"} — ${age} pregão(ões) atrás. Este prêmio não é da sessão corrente.`}
    >
      {critico && o.lastTradeAt ? fmtDateBR(o.lastTradeAt) : `D-${age}`}
    </span>
  );
}

/** Tooltip da IV explicitando com qual spot ela foi extraída (WO-30 §2.3). */
function ivTitle(o: OptionQuote): string {
  if (o.iv == null) {
    return o.last == null
      ? "Sem prêmio negociado — não há IV a extrair."
      : "Sem fechamento do ativo na data deste prêmio — IV não calculada para não misturar datas.";
  }
  const d = o.ivSpotDate ? fmtDateBR(o.ivSpotDate) : "spot manual";
  return `IV extraída com o fechamento de ${d} (mesma data do prêmio). Engine local.`;
}

/** WO-61: bid/ask da série — ao vivo (MT5) em verde, de fechamento (COTAHIST) em ciano. */
function BidAsk({ o, align }: { o: OptionQuote; align: "left" | "right" }) {
  const tem = o.bid != null || o.ask != null;
  if (!tem) return <td className={clsx("td text-term-dim", align === "left" ? "text-left" : "text-right")}>—</td>;
  const aoVivo = Boolean(o.tickAt);
  const titulo = aoVivo
    ? `Book ao vivo (MT5) — tick ${o.tickAt!.slice(11, 19)}${o.mid != null ? ` · mid ${fmtNum(o.mid)}` : ""}`
    : `Oferta de fechamento (COTAHIST${o.ofertasData ? ` ${fmtDateBR(o.ofertasData)}` : ""})${o.mid != null ? ` · mid ${fmtNum(o.mid)}` : ""}`;
  return (
    <td className={clsx("td whitespace-nowrap", align === "left" ? "text-left" : "text-right", aoVivo ? "text-term-green" : "text-term-cyan")} title={titulo}>
      {o.bid != null ? fmtNum(o.bid) : "—"}/{o.ask != null ? fmtNum(o.ask) : "—"}
    </td>
  );
}

function CallCells({ o, spot, onAdd }: { o: OptionQuote | null; spot: number; onAdd: (o: OptionQuote, s: 1 | -1) => void }) {
  if (!o) return <td className="td text-term-dim text-right" colSpan={8}>—</td>;
  const stale = o.markQuality === "stale";
  const bg = clsx(itm(o, spot) && "bg-term-up/5", stale && "text-term-dim");
  const ageTitle = stale
    ? o.lastTradeAt
      ? `Marcação stale — último negócio há ${o.tradeAgeSessions ?? 0} pregão(ões) (${fmtDateBR(o.lastTradeAt)}) — excluída de smile/skew/scanner`
      : "Marcação stale (sem negócios ou last < intrínseco) — excluída de smile/skew/scanner"
    : undefined;

  return (
    <>
      <td className={clsx("td text-right", bg)}>
        <span className="text-term-dim">{o.opTicker.replace(o.underlying.slice(0, 4), "")}</span>
        <TradeBtns o={o} onAdd={onAdd} />
      </td>
      <BidAsk o={o} align="right" />
      <td className={clsx("td text-right font-semibold", bg)}>
        {fmtNum(o.last)}
        <AgeChip o={o} />
      </td>
      <td
        className={clsx("td text-right", bg, stale ? "line-through" : "text-term-gold")}
        title={ageTitle ?? ivTitle(o)}
      >
        {fmtPct(o.iv)}
      </td>
      <td className={clsx("td text-right", bg, !stale && "text-term-cyan")}>{fmtNum(o.delta, 3)}</td>
      <td className={clsx("td text-right", bg)}>{fmtNum(o.gamma, 4)}</td>
      <td className={clsx("td text-right", bg, !stale && "text-term-down")}>{fmtNum(o.theta, 4)}</td>
      <NegVol o={o} align="right" bg={bg} />
    </>
  );
}

/** Negócios/volume do dia; provisório (~) enquanto a ponte MT5 completa o cache diário da série. */
function NegVol({ o, align, bg }: { o: OptionQuote; align: "left" | "right"; bg: string }) {
  if (o.diarioProvisorio) {
    return (
      <td className={clsx("td text-term-dim", align === "left" ? "text-left" : "text-right", bg)} title="Provisório: a ponte MT5 ainda está completando o cache diário desta série (negócios e último negócio vêm do candle diário). O próximo pedido traz o número certo.">
        ~{fmtCompact(o.trades)}/—
      </td>
    );
  }
  return (
    <td className={clsx("td text-term-dim", align === "left" ? "text-left" : "text-right", bg)}>
      {fmtCompact(o.trades)}/{fmtCompact(o.volumeFin)}
    </td>
  );
}

function PutCells({ o, spot, onAdd }: { o: OptionQuote | null; spot: number; onAdd: (o: OptionQuote, s: 1 | -1) => void }) {
  if (!o) return <td className="td text-term-dim" colSpan={8}>—</td>;
  const stale = o.markQuality === "stale";
  const bg = clsx(itm(o, spot) && "bg-term-up/5", stale && "text-term-dim");
  const ageTitle = stale
    ? o.lastTradeAt
      ? `Marcação stale — último negócio há ${o.tradeAgeSessions ?? 0} pregão(ões) (${fmtDateBR(o.lastTradeAt)}) — excluída de smile/skew/scanner`
      : "Marcação stale (sem negócios ou last < intrínseco) — excluída de smile/skew/scanner"
    : undefined;

  return (
    <>
      <NegVol o={o} align="left" bg={bg} />
      <td className={clsx("td text-left", bg, !stale && "text-term-down")}>{fmtNum(o.theta, 4)}</td>
      <td className={clsx("td text-left", bg)}>{fmtNum(o.gamma, 4)}</td>
      <td className={clsx("td text-left", bg, !stale && "text-term-cyan")}>{fmtNum(o.delta, 3)}</td>
      <td
        className={clsx("td text-left", bg, stale ? "line-through" : "text-term-gold")}
        title={ageTitle ?? ivTitle(o)}
      >
        {fmtPct(o.iv)}
      </td>
      <td className={clsx("td text-left font-semibold", bg)}>
        <AgeChip o={o} />
        {fmtNum(o.last)}
      </td>
      <BidAsk o={o} align="left" />
      <td className={clsx("td text-left", bg)}>
        <TradeBtns o={o} onAdd={onAdd} />
        <span className="text-term-dim">{o.opTicker.replace(o.underlying.slice(0, 4), "")}</span>
      </td>
    </>
  );
}
