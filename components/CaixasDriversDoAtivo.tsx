"use client";
import { useMemo } from "react";
import clsx from "clsx";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { votoDriver, type DriverBody, type DriversBody, type Vies } from "@/lib/drivers-calculos";
import { fmtValorDriver, fmtVarDriver } from "@/components/CartaoDriver";
import { fmtDateBR } from "@/lib/format";

/**
 * WO-66 (AJ 22/09/2026) — no Perfil de Risco do Book, ao lado do payoff de cada ativo, as três
 * caixas com os drivers de MAIOR CORRELAÇÃO medida com o papel: série de 2 anos, último valor
 * com data, variação em 21 pregões, correlação, e se o driver empurra a favor ou contra a
 * direção da posição no ativo (lida da inclinação da curva de P&L de hoje no spot). Leitura,
 * nunca veto. As caixas ocupam a altura do cartão do payoff.
 */

const N_CAIXAS = 3;

/** Os 3 drivers que mais explicam o papel no último ano; completa com os demais na ordem da tabela. */
export function top3Drivers(drivers: DriverBody[], n = N_CAIXAS): DriverBody[] {
  const comCorr = drivers
    .filter((d) => d.cadencia === "diaria" && d.medida.corr != null)
    .sort((a, b) => Math.abs(b.medida.corr ?? 0) - Math.abs(a.medida.corr ?? 0));
  const escolhidos = comCorr.slice(0, n);
  if (escolhidos.length < n) {
    for (const d of drivers) {
      if (escolhidos.length >= n) break;
      if (!escolhidos.includes(d)) escolhidos.push(d);
    }
  }
  return escolhidos;
}

/**
 * A direção da posição no ativo pela inclinação da curva de P&L de hoje em torno do spot (±1 %):
 * ALTA quando ganha com o papel subindo, BAIXA quando ganha com ele caindo, NEUTRA quando a
 * diferença é menor que 5 % do custo total (straddle no dinheiro, condor, call + put opostas:
 * um straddle de PETR4 a 48,17 com spot 48,02 muda ~1,4 % do custo em ±1 %; uma call seca, ~20 %).
 */
export const LIMIAR_DIRECAO = 0.05;

export function direcaoPelaCurva(curva: Array<{ s: number; t0: number }>, spot: number, custoTotal: number): Vies {
  if (!curva.length || !(spot > 0)) return "NEUTRA";
  const maisPerto = (alvo: number) => curva.reduce((m, p) => (Math.abs(p.s - alvo) < Math.abs(m.s - alvo) ? p : m), curva[0]);
  const acima = maisPerto(spot * 1.01);
  const abaixo = maisPerto(spot * 0.99);
  if (acima === abaixo) return "NEUTRA";
  const delta = acima.t0 - abaixo.t0;
  const limiar = Math.max(1, LIMIAR_DIRECAO * Math.abs(custoTotal));
  if (delta > limiar) return "ALTA";
  if (delta < -limiar) return "BAIXA";
  return "NEUTRA";
}

function Caixa({ d, direcao }: { d: DriverBody; direcao: Vies }) {
  const m = d.medida;
  const dados = useMemo(() => d.pontos.map((p) => ({ date: p.date, valor: p.valor })), [d.pontos]);
  const voto = votoDriver({ codigo: d.codigo, nome: d.nome, cadencia: d.cadencia, medida: m }, direcao);
  const chip = voto.direcao === 0
    ? { texto: d.cadencia === "mensal" ? "mensal" : "sem voto", cls: "bg-term-panel2 text-term-dim" }
    : voto.aFavor === true
      ? { texto: "a favor", cls: "bg-term-up/15 text-term-up" }
      : voto.aFavor === false
        ? { texto: "contra", cls: "bg-term-down/15 text-term-down" }
        : { texto: voto.direcao === 1 ? "empurra ↑" : "empurra ↓", cls: "bg-term-panel2 text-term-text" };
  const varCls = m.var21 == null ? "text-term-dim" : m.var21 > 0 ? "text-term-up" : m.var21 < 0 ? "text-term-down" : "text-term-dim";
  return (
    <div className="rounded border border-term-line/60 bg-term-panel/60 p-1.5 min-w-0 flex flex-col text-[10px] font-mono">
      <div className="flex items-center justify-between gap-1">
        <span className="font-bold text-term-text truncate" title={`${d.descricao} — ${d.porQue}`}>{d.nome}</span>
        <span className="text-term-dim whitespace-nowrap" title={m.ate ? `correlação em ${m.pares} pares até ${fmtDateBR(m.ate)}` : "sem pares suficientes"}>
          {m.corr != null ? `corr ${m.corr.toFixed(2)}` : "sem corr"}
        </span>
      </div>
      <div className="flex-1 min-h-[6rem]">
        {dados.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dados} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#0b0f17", border: "1px solid #232a36", fontSize: 10 }}
                labelFormatter={(l) => fmtDateBR(String(l))}
                formatter={(v) => [fmtValorDriver(Number(v), d.unidade), d.nome]}
              />
              <Line type="monotone" dataKey="valor" stroke={d.cadencia === "mensal" ? "#f5c451" : "#22d3ee"} strokeWidth={1.1} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-term-dim">{d.erro ?? "sem série"}</div>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 pt-0.5">
        <span className="text-term-text">{fmtValorDriver(m.ultimo, d.unidade)}</span>
        <span className="text-term-dim">{m.dataUltimo ? fmtDateBR(m.dataUltimo) : "—"}</span>
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-term-dim">21p <span className={varCls}>{fmtVarDriver(m.var21, d.unidade)}</span>{d.stale ? " · STALE" : ""}</span>
        <span className={clsx("tag", chip.cls)} title={voto.motivo}>{chip.texto}</span>
      </div>
    </div>
  );
}

interface Props {
  ticker: string;
  body: DriversBody | undefined;
  erro: string | undefined;
  carregando: boolean;
  direcao: Vies;
}

export function CaixasDriversDoAtivo({ ticker, body, erro, carregando, direcao }: Props) {
  const tres = useMemo(() => (body ? top3Drivers(body.drivers) : []), [body]);
  if (!body) {
    return (
      <div className="rounded border border-term-line/40 bg-term-panel/40 flex items-center justify-center text-xxs text-term-dim font-mono min-h-[10rem]">
        {carregando ? `buscando os drivers de ${ticker}…` : erro ?? `sem drivers para ${ticker}`}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 items-stretch min-h-[10rem]" title={`os 3 drivers de maior correlação com ${ticker} em 252 pregões; a favor/contra é contra a direção da posição no ativo (${direcao === "ALTA" ? "alta" : direcao === "BAIXA" ? "baixa" : "sem lado"})`}>
      {tres.map((d) => (
        <Caixa key={d.codigo} d={d} direcao={direcao} />
      ))}
    </div>
  );
}
