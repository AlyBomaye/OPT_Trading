"use client";

/**
 * WO-69 — o câmbio em quatro pares, lado a lado:
 *
 *   ┌ USD/BRL ───────────┐┌ EUR/BRL ───────────┐
 *   │ 5,1659  23/09 Yahoo ││ …                  │
 *   │ Δ1D Δ1M Δ1A         ││                    │
 *   │ ~~~~ linha ~~~~     ││                    │
 *   └────────────────────┘└────────────────────┘
 *   ┌ EUR/USD ───────────┐┌ USD/CNY ───────────┐
 *
 * Um seletor de janela (1M · 3M · 6M · 1A) troca os quatro juntos: a graça é ver os pares no mesmo
 * período. Cada cartão diz de onde veio o número (Yahoo, PTAX ou MT5) e de quando — e quando é o
 * último dado bom porque a rede falhou, diz isso também. Sem tabela: os chips são a tabela.
 */

import { useMemo } from "react";
import clsx from "clsx";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { MacroSeries } from "@/app/api/macro/route";
import { fmtDateBR, fmtNum } from "@/lib/format";
import { construirProvenance, corFrescor } from "@/lib/provenance";

export type JanelaFx = "1M" | "3M" | "6M" | "1A";
export const JANELAS_FX: { chave: JanelaFx; pregoes: number }[] = [
  { chave: "1M", pregoes: 21 },
  { chave: "3M", pregoes: 63 },
  { chave: "6M", pregoes: 126 },
  { chave: "1A", pregoes: 252 },
];

export interface ParCambio {
  /** "USD/BRL" */
  titulo: string;
  /** O símbolo na Macro ("USDBRL=X") — chave dos motivos de falha. */
  simbolo: string;
  /** "R$ por US$" */
  unidade: string;
  serie: MacroSeries | undefined;
  decimais: number;
  cor: string;
}

/** Os últimos N pregões da série, com data — o que a janela recorta. */
export function recortarJanela(serie: MacroSeries | undefined, janela: JanelaFx): Array<{ date: string; valor: number }> {
  if (!serie?.closes1y?.length) return [];
  const n = JANELAS_FX.find((j) => j.chave === janela)?.pregoes ?? 63;
  const closes = serie.closes1y;
  const datas = serie.datas1y ?? [];
  const inicio = Math.max(0, closes.length - n);
  const out: Array<{ date: string; valor: number }> = [];
  for (let i = inicio; i < closes.length; i++) out.push({ date: datas[i] ?? "", valor: closes[i] });
  return out;
}

function Chip({ rotulo, valor }: { rotulo: string; valor: number | null | undefined }) {
  const ok = valor != null && Number.isFinite(valor);
  const pct = ok ? (valor as number) * 100 : null;
  const cls = pct == null ? "text-term-dim" : pct > 0 ? "text-term-up" : pct < 0 ? "text-term-down" : "text-term-dim";
  return (
    <span className="tag bg-term-panel2 font-mono" title={`variação em ${rotulo}`}>
      <span className="text-term-dim mr-1">{rotulo}</span>
      <span className={cls}>{pct == null ? "—" : `${pct >= 0 ? "+" : ""}${fmtNum(pct, 2)}%`}</span>
    </span>
  );
}

function rotuloFonte(s: MacroSeries | undefined): string {
  if (!s) return "—";
  if (s.fonte === "mt5") return "MT5";
  if (s.fonte === "ptax") return "PTAX";
  return "Yahoo";
}

function Cartao({ par, janela, motivo }: { par: ParCambio; janela: JanelaFx; motivo?: string }) {
  const s = par.serie;
  const dados = useMemo(() => recortarJanela(s, janela), [s, janela]);
  const prov = construirProvenance(rotuloFonte(s), s?.dataDoDado ?? null);
  return (
    <div className="rounded border border-term-line/60 bg-term-panel p-2 min-w-0 flex flex-col">
      <div className="flex items-center justify-between gap-1">
        <span className="font-bold text-xs text-term-cyan">{par.titulo}</span>
        <div className="flex items-center gap-1 whitespace-nowrap">
          {s?.stale && (
            <span className="tag bg-term-gold/20 text-term-gold" title={s.motivo ?? "a rede falhou; este é o último dado bom"}>
              STALE
            </span>
          )}
          <span className={clsx("tag bg-term-panel2", corFrescor(prov.frescor))} title={`${rotuloFonte(s)} · dado de ${s?.dataDoDado ? fmtDateBR(s.dataDoDado) : "—"}`}>
            {rotuloFonte(s)} · {s?.dataDoDado ? fmtDateBR(s.dataDoDado) : "—"}
          </span>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <span className="font-mono text-lg text-term-text">{s?.last != null ? fmtNum(s.last, par.decimais) : "—"}</span>
        <span className="text-xxs text-term-dim">{par.unidade}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 mt-1">
        <Chip rotulo="1D" valor={s?.chg1d} />
        <Chip rotulo="1M" valor={s?.chg1m} />
        <Chip rotulo="1A" valor={s?.chg12m} />
      </div>
      <div className="h-24 mt-1">
        {dados.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dados} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 10 }}
                labelFormatter={(l) => (l ? fmtDateBR(String(l)) : "")}
                formatter={(v: any) => [fmtNum(Number(v), par.decimais), par.titulo]}
              />
              <Line type="monotone" dataKey="valor" stroke={par.cor} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xxs text-term-dim text-center px-2">
            {motivo ? `sem série: ${motivo}` : "sem série nesta execução"}
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  pares: ParCambio[];
  janela: JanelaFx;
  onJanela: (j: JanelaFx) => void;
  /** `motivos` do corpo da Macro, por símbolo — o porquê de um par estar sem série. */
  motivos?: Record<string, string>;
}

export function CartoesCambio({ pares, janela, onJanela, motivos }: Props) {
  return (
    <div className="bg-term-panel rounded border border-term-line/60">
      <div className="flex items-center justify-between border-b border-term-line/40 px-3 py-2 gap-2">
        <span className="font-bold text-xs text-term-cyan">Câmbio — USD/BRL · EUR/BRL · EUR/USD · USD/CNY</span>
        <div className="flex items-center gap-1">
          {JANELAS_FX.map((j) => (
            <button
              key={j.chave}
              onClick={() => onJanela(j.chave)}
              className={clsx("tag", janela === j.chave ? "bg-term-cyan/15 text-term-cyan border border-term-cyan/50" : "bg-term-panel2 text-term-dim")}
              title={`${j.pregoes} pregões`}
            >
              {j.chave}
            </button>
          ))}
        </div>
      </div>
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {pares.map((p) => (
          <Cartao key={p.titulo} par={p} janela={janela} motivo={p.serie?.motivo ?? motivos?.[p.simbolo]} />
        ))}
      </div>
      <div className="px-3 pb-2 text-xxs text-term-dim">
        Cotação de mercado (Yahoo), intradiária; quando o Yahoo falha, USD/BRL, EUR/BRL e EUR/USD caem para o boletim de fechamento do PTAX
        (Banco Central) e o USD/CNY para o último dado bom — o PTAX não tem yuan. Chips: variação acumulada em 1 dia, 1 mês e 1 ano.
      </div>
    </div>
  );
}
