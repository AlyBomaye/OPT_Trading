"use client";

/**
 * WO-55 — as fichas por estrutura no Consultor: a tela da manhã do método, sem agente e sem LLM.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layers, CheckCircle2, AlertTriangle, RefreshCw, XCircle, Eye, HelpCircle } from "lucide-react";
import clsx from "clsx";
import { markInfo, useMarket } from "@/store/market";
import { useDividends } from "@/lib/dividends";
import { evaluateFlags, useFlagSettings } from "@/lib/position-flags";
import { useLivro } from "@/lib/hooks/useLivro";
import { fichasDasEstruturas, type Veredito } from "@/lib/consultor-estruturas";
import { REALIZAR_PCT_LUCRO_MAXIMO, type Regime } from "@/lib/metodo";
import { fmtBRL, fmtNum, fmtPct } from "@/lib/format";

const VEREDITO: Record<Veredito, { rotulo: string; cls: string; Icone: typeof CheckCircle2 }> = {
  zerar: { rotulo: "ZERAR", cls: "text-term-down border-term-down/50 bg-term-down/10", Icone: XCircle },
  "regime-virou": { rotulo: "REGIME VIROU", cls: "text-term-down border-term-down/50 bg-term-down/10", Icone: AlertTriangle },
  realizar: { rotulo: "REALIZAR", cls: "text-term-up border-term-up/50 bg-term-up/10", Icone: CheckCircle2 },
  rolar: { rotulo: "ROLAR", cls: "text-term-gold border-term-gold/50 bg-term-gold/10", Icone: RefreshCw },
  "sem-marcacao": { rotulo: "SEM MARCAÇÃO", cls: "text-term-dim border-term-line bg-term-panel2", Icone: HelpCircle },
  manter: { rotulo: "MANTER", cls: "text-term-cyan border-term-cyan/50 bg-term-cyan/10", Icone: Eye },
};

export function FichasEstruturas() {
  const { positions, chainCache, selic, capitalTotal, refresh } = useMarket();
  const divsByTicker = useDividends((st) => st.byTicker);
  const thresholds = useFlagSettings((st) => st.thresholds);
  const { tabelaCustos } = useLivro();
  const [regimes, setRegimes] = useState<Record<string, Regime>>({});

  useEffect(() => {
    let vivo = true;
    fetch("/api/regime", { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j?.regimes) setRegimes(Object.fromEntries(Object.entries(j.regimes as Record<string, { regime: Regime }>).map(([t, m]) => [t, m.regime])));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // Cadeias que faltam para marcar o book: busca uma vez por visita (mesmo padrão da Carteira).
  useEffect(() => {
    const faltam = Array.from(new Set(positions.map((p) => p.underlying))).filter((t) => !chainCache[t]);
    if (!faltam.length) return;
    (async () => {
      for (const t of faltam) {
        try {
          await refresh(t);
        } catch {
          /* fica sem marcação; a ficha diz */
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.length]);

  const flags = useMemo(
    () => evaluateFlags(positions, chainCache, divsByTicker, capitalTotal, thresholds, regimes, selic),
    [positions, chainCache, divsByTicker, capitalTotal, thresholds, regimes, selic]
  );
  const fichas = useMemo(
    () => fichasDasEstruturas({ positions, chainCache, selic, tabela: tabelaCustos, flags, regimes, marcacaoDe: (p) => markInfo(p, chainCache).price }),
    [positions, chainCache, selic, tabelaCustos, flags, regimes]
  );

  if (fichas.length === 0) return null;
  const acao = fichas.filter((f) => f.veredito !== "manter" && f.veredito !== "sem-marcacao").length;

  return (
    <div id="fichas" className="panel border-l-2 !border-l-term-cyan">
      <div className="panel-title flex items-center gap-2 flex-wrap">
        <Layers size={14} className="text-term-cyan" />
        <span className="font-bold">As estruturas hoje — as três perguntas do método, respondidas pela tela</span>
        <span className={clsx("tag", acao > 0 ? "bg-term-gold/15 text-term-gold" : "bg-term-panel2 text-term-dim")}>
          {fichas.length} estrutura(s) · {acao} pede(m) ação
        </span>
        <Link href="/portfolio#acao-do-dia" className="text-xxs text-term-cyan ml-auto">agir na Carteira →</Link>
      </div>
      <div className="px-3 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
        {fichas.map((f) => {
          const v = VEREDITO[f.veredito];
          return (
            <div key={f.chave} className={clsx("rounded border p-2 text-xxs space-y-1", v.cls.split(" ").filter((c) => c.startsWith("border")).join(" "), "border-opacity-60 bg-term-panel")}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono">
                  <b className="text-term-cyan">{f.underlying}</b> · {f.nome} · {f.pernas} perna(s) · {f.duRestantes != null ? `${f.duRestantes} DU` : "DU —"}
                </span>
                <span className={clsx("tag border font-mono font-bold flex items-center gap-1", v.cls)}>
                  <v.Icone size={11} /> {v.rotulo}
                </span>
              </div>
              <div className="leading-relaxed">{f.motivo}</div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 font-mono pt-1 border-t border-term-line/30">
                <span className="text-term-dim">1. Quanto ganho?</span>
                <span className="col-span-2">
                  {f.ganhoRestante != null ? <>faltam <b className="text-term-up">{fmtBRL(f.ganhoRestante)}</b> até o máximo líquido {fmtBRL(f.maxProfitLiquido!)}</> : <span className="text-term-dim">ganho sem teto</span>}
                  {f.precoAlvo70 != null && f.spot != null && <> · {Math.round(REALIZAR_PCT_LUCRO_MAXIMO * 100)}% em <b className="text-term-gold">{fmtNum(f.precoAlvo70, 2)}</b> ({fmtPct(f.precoAlvo70 / f.spot - 1)})</>}
                </span>
                <span className="text-term-dim">2. Quanto perco?</span>
                <span className="col-span-2">
                  {f.maxLossLiquido != null ? <b className="text-term-down">{fmtBRL(f.maxLossLiquido)}</b> : <span className="text-term-down">sem teto</span>}
                  {f.zeragem && (f.zeragem.abaixo != null || f.zeragem.acima != null) && (
                    <span className="text-term-dim"> · zera líquida em {f.zeragem.abaixo != null ? fmtNum(f.zeragem.abaixo, 2) : "—"} / {f.zeragem.acima != null ? fmtNum(f.zeragem.acima, 2) : "—"}</span>
                  )}
                </span>
                <span className="text-term-dim">3. Quando saio?</span>
                <span className="col-span-2">
                  P&L líquido agora <b className={f.pnlLiquido == null ? "text-term-dim" : f.pnlLiquido >= 0 ? "text-term-up" : "text-term-down"}>{f.pnlLiquido != null ? fmtBRL(f.pnlLiquido) : "—"}</b>
                  {f.fracaoDoMaximo != null && <> ({fmtPct(f.fracaoDoMaximo)} do máximo)</>}
                  {" · regime "}{f.regimeAgora ?? "não marcado"}{f.regimeEntrada ? ` (entrou em ${f.regimeEntrada})` : ""}
                  {f.flags.length > 0 && <> · flags: {Array.from(new Set(f.flags.map((x) => x.kind))).join(", ")}</>}
                </span>
              </div>
              {f.tese && <div className="text-term-dim italic">tese: {f.tese}{f.alvo != null ? ` · alvo ${fmtNum(f.alvo, 2)}` : ""}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
