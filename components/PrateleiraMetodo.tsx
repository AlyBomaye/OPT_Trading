"use client";

/**
 * WO-51 — a prateleira do dia.
 *
 * Varre o universo (duas cadeias por vez, no `chainCache` do store — o mesmo que a Carteira usa
 * para marcar o book), lê o regime marcado de cada papel, classifica a vol (IV rank do banco;
 * sem ele, o spread IV−HV21 da Watchlist) e monta as estruturas do método por vencimento na janela.
 * Tudo líquido de custos pela tabela vigente. "Montar na Estratégia" leva a escolhida para o
 * Workbench com papel, vencimento e pernas já selecionados.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Play, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { UNIVERSE } from "@/lib/universe";
import { useWatchlist } from "@/lib/sector-dashboard";
import { useLivro } from "@/lib/hooks/useLivro";
import { useIvRanks } from "@/lib/hooks/useIvRank";
import { derivarSkewAtm } from "@/lib/hooks/useSkewAtm";
import { classificarVol, JANELA_DU, type Regime, type RegimeVol } from "@/lib/metodo";
import { montarPrateleira, ordenarPrateleira, type ItemPrateleira } from "@/lib/prateleira";
import { usePersistedState } from "@/lib/use-persisted-state";
import { fmtBRL, fmtDateBR, fmtNum, fmtPct } from "@/lib/format";

const ROTULO_VOL: Record<RegimeVol, string> = { alta: "vol alta", media: "vol média", baixa: "vol baixa", indefinida: "vol ?" };

export function PrateleiraMetodo() {
  const router = useRouter();
  const { chainCache, refresh, selic, setTicker, setSelectedExpiry, setLegs } = useMarket();
  const { rows: watchRows } = useWatchlist();
  const { tabelaCustos } = useLivro();
  const [aberta, setAberta] = usePersistedState<boolean>("scanner-prateleira-open", true);
  const [porPapel, setPorPapel] = usePersistedState<number>("scanner-prateleira-por-papel", 3);
  const [varrendo, setVarrendo] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [varridoEm, setVarridoEm] = useState<string | null>(null);
  const [regimes, setRegimes] = useState<Record<string, { regime: Regime; observadoEm: string }>>({});
  const [soAderentes, setSoAderentes] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/regime", { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j?.regimes && typeof j.regimes === "object") setRegimes(j.regimes);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // IV ATM por papel a partir da cadeia (primeiro vencimento mensal), para o IV rank do banco.
  const itensRank = useMemo(
    () =>
      UNIVERSE.map((u) => {
        const c = chainCache[u.ticker];
        const exp = c?.expiries.find((e) => e.isMonthly)?.date ?? c?.expiries[0]?.date ?? null;
        return { ticker: u.ticker, iv: c && exp ? derivarSkewAtm(c, exp).atmIv : null };
      }),
    [chainCache]
  );
  const ranks = useIvRanks(itensRank);

  const varrer = useCallback(async () => {
    if (varrendo) return;
    setVarrendo(true);
    setProgresso(0);
    const fila = UNIVERSE.map((u) => u.ticker);
    let feitos = 0;
    const trabalhador = async () => {
      while (fila.length) {
        const t = fila.shift();
        if (!t) break;
        try {
          await refresh(t);
        } catch {
          /* sem cadeia o papel simplesmente não entra na prateleira */
        }
        feitos++;
        setProgresso(feitos / UNIVERSE.length);
      }
    };
    await Promise.all([trabalhador(), trabalhador()]);
    setVarridoEm(new Date().toISOString());
    setVarrendo(false);
  }, [varrendo, refresh]);

  const itens = useMemo(() => {
    const tudo: ItemPrateleira[] = [];
    for (const u of UNIVERSE) {
      const chain = chainCache[u.ticker];
      if (!chain) continue;
      const item = itensRank.find((i) => i.ticker === u.ticker);
      const w = watchRows[u.ticker];
      const spread = item?.iv != null && w?.hv21 != null ? (item.iv - w.hv21) * 100 : null;
      const vol = classificarVol(ranks[u.ticker]?.ivRank ?? null, spread);
      tudo.push(...montarPrateleira({ chain, selic, tabela: tabelaCustos, regime: regimes[u.ticker]?.regime ?? null, vol }));
    }
    return ordenarPrateleira(tudo);
  }, [chainCache, itensRank, watchRows, ranks, selic, tabelaCustos, regimes]);

  const visiveis = useMemo(() => {
    const contagem = new Map<string, number>();
    return itens.filter((i) => {
      if (soAderentes && !(i.adereRegime === true && i.adereVol !== false)) return false;
      const n = contagem.get(i.ticker) ?? 0;
      if (n >= porPapel) return false;
      contagem.set(i.ticker, n + 1);
      return true;
    });
  }, [itens, soAderentes, porPapel]);

  const montar = (i: ItemPrateleira) => {
    setTicker(i.ticker);
    setSelectedExpiry(i.expiry);
    setLegs(i.legs);
    router.push("/estrategia");
  };

  const papeisComCadeia = UNIVERSE.filter((u) => chainCache[u.ticker]).length;

  return (
    <div id="prateleira" className="panel border-l-2 !border-l-term-cyan">
      <div onClick={() => setAberta(!aberta)} className="panel-title flex items-center justify-between cursor-pointer select-none">
        <div className="flex items-center gap-2">
          {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Layers size={14} className="text-term-cyan" />
          <span className="font-bold">Prateleira do método — estruturas do manual, julgadas e líquidas de custos</span>
          <span className="tag bg-term-panel2 text-term-dim">
            {papeisComCadeia}/{UNIVERSE.length} papéis com cadeia · janela {JANELA_DU.min}–{JANELA_DU.max} DU
          </span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {varridoEm && !varrendo && (
            <span className="text-xxs text-term-dim">varrido às {new Date(varridoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
          )}
          <button className="btn btn-primary text-xxs !py-0.5 !px-2 flex items-center gap-1" onClick={() => void varrer()} disabled={varrendo}>
            <Play size={11} /> {varrendo ? `Varrendo… ${Math.round(progresso * 100)}%` : "Varrer o método"}
          </button>
        </div>
      </div>

      {aberta && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xxs text-term-dim pt-2">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={soAderentes} onChange={(e) => setSoAderentes(e.target.checked)} />
              só o que adere ao regime marcado e à vol
            </label>
            <label className="flex items-center gap-1">
              por papel:
              <select value={porPapel} onChange={(e) => setPorPapel(Number(e.target.value))} className="cell-input !w-14">
                {[1, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <span>
              custos: {tabelaCustos.vigenteDesde === "sugestao" ? "sugestão XP/B3 (confirme na Carteira)" : `tabela vigente desde ${tabelaCustos.vigenteDesde}`} · regime: marcação do trader (Contexto) · vol: IV rank do banco, ou IV−HV21 sem histórico
            </span>
          </div>

          {itens.length === 0 ? (
            <div className="text-xxs text-term-dim py-3">
              {papeisComCadeia === 0
                ? "Nenhuma cadeia carregada — clique em \"Varrer o método\" para buscar as do universo."
                : "Nenhuma estrutura líquida montável nos vencimentos da janela — sem prêmio e negócios nas séries certas hoje."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
                  <tr>
                    {["Papel", "Regime · vol", "Estrutura", "Venc", "Pernas", "Déb/Créd líq.", "Máx lucro", "Máx perda", "PoP", "EV/risco", "Critérios", ""].map((h) => (
                      <th key={h} className="th text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((i) => {
                    const r = regimes[i.ticker]?.regime ?? null;
                    const vol = classificarVol(ranks[i.ticker]?.ivRank ?? null, null);
                    const corAd = i.adereRegime === true ? "text-term-up" : i.adereRegime === false ? "text-term-down" : "text-term-dim";
                    const corSit = i.situacao === "ok" ? "text-term-up" : i.situacao === "atencao" ? "text-term-gold" : i.situacao === "fora" ? "text-term-down" : "text-term-dim";
                    return (
                      <tr key={`${i.ticker}|${i.expiry}|${i.preset}`} className="border-b border-term-line/40 hover:bg-term-panel2/50">
                        <td className="td font-semibold text-term-cyan">{i.ticker}</td>
                        <td className={clsx("td text-right text-xxs", corAd)} title={i.adereRegime == null ? "Sem regime marcado — marque no Contexto da Estratégia" : i.adereRegime ? "Estrutura do regime marcado" : "Contraria o regime marcado"}>
                          {r ?? "sem regime"} · {ranks[i.ticker]?.ivRank != null ? ROTULO_VOL[vol] : "vol s/ rank"}
                        </td>
                        <td className="td text-right whitespace-nowrap" title={`Capítulo ${i.capitulo} do método`}>
                          {i.estrutura} <span className="text-term-dim text-xxs">cap. {i.capitulo}</span>
                        </td>
                        <td className={clsx("td text-right whitespace-nowrap", i.foraDaJanela && "text-term-gold")} title={i.foraDaJanela ? "Fora da janela do método — não havia vencimento entre 20 e 40 DU" : undefined}>
                          {fmtDateBR(i.expiry)} · {i.du} DU{i.foraDaJanela ? " ⚠" : ""}
                        </td>
                        <td className="td text-right text-xxs font-mono text-term-dim whitespace-nowrap" title={i.rotulo}>{i.rotulo}</td>
                        <td className={clsx("td text-right font-semibold", i.dec.netDebit >= 0 ? "text-term-down" : "text-term-up")} title={i.custos != null ? `bruto ${fmtBRL(Math.abs(i.metrics.netDebit))} · custos ida e volta ${fmtBRL(i.custos)}` : "sem tabela de custos"}>
                          {i.dec.netDebit >= 0 ? "−" : "+"}{fmtBRL(Math.abs(i.dec.netDebit))}
                        </td>
                        <td className="td text-right text-term-up">{i.dec.maxProfit == null ? "∞" : fmtBRL(i.dec.maxProfit)}</td>
                        <td className="td text-right text-term-down">{i.dec.maxLoss == null ? "∞" : fmtBRL(i.dec.maxLoss)}</td>
                        <td className="td text-right text-term-cyan">{i.dec.pop != null ? fmtPct(i.dec.pop) : "—"}</td>
                        <td className={clsx("td text-right font-mono", i.score > 0 ? "text-term-up" : "text-term-down")} title={`EV líquido ${fmtBRL(i.ev)}`}>{fmtNum(i.score, 2)}×</td>
                        <td className={clsx("td text-right text-xxs whitespace-nowrap", corSit)} title={i.criterios.map((c) => `${c.rotulo}: ${c.medido} (${c.exigido}) — ${c.situacao}`).join("\n")}>
                          {i.resumoCriterios}
                        </td>
                        <td className="td text-right">
                          <button className="tag bg-term-cyan/15 text-term-cyan hover:bg-term-cyan/30 whitespace-nowrap" onClick={() => montar(i)}>
                            Montar na Estratégia →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xxs text-term-dim leading-relaxed">
            Risco definido apenas: venda a seco, straddle vendido e booster ficam na Estratégia, onde a tela mostra a perda sem teto.
            Ordem: adere ao regime e à vol → critérios do método (ok, atenção, fora) → EV líquido ÷ perda máxima. Cada linha é a melhor
            candidata do motor de sugestões para aquela estrutura e vencimento; "Montar" abre exatamente essas pernas.
          </p>
        </div>
      )}
    </div>
  );
}
