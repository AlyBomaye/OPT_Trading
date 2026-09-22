"use client";
import { useMemo } from "react";
import clsx from "clsx";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { emPontos, type DriverBody, type VotoDriver } from "@/lib/drivers-calculos";
import type { UnidadeDriver } from "@/lib/drivers-catalogo";
import { fmtDateBR, fmtNum } from "@/lib/format";

/**
 * WO-64 / WO-66 — O cartão de um driver: nome, o "por quê" do par, gráfico de 2 anos, último
 * valor com data, chip da fonte (STALE quando o disco venceu, "proxy" quando a série substitui
 * outra), z, variações, correlação/beta e o voto. A Estratégia (`PainelDrivers`) e o Portfolio
 * (`PainelDriversBook`) usam o mesmo cartão — uma aparência, uma regra.
 */

const FONTE_ROTULO: Record<string, string> = { mt5: "MT5", yahoo: "Yahoo", bcb: "BCB" };

export function fmtValorDriver(v: number | null | undefined, unidade: UnidadeDriver): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (unidade) {
    case "taxa":
    case "pct":
      return `${v.toFixed(2)}%`;
    case "brl":
      return `R$ ${fmtNum(v, v < 10 ? 4 : 2)}`;
    case "usd":
      return `US$ ${fmtNum(v, 2)}`;
    case "usx":
      return `${fmtNum(v, 2)} ¢`;
    case "indice":
      return fmtNum(v, 2);
    default:
      return fmtNum(v, v >= 1000 ? 0 : 2);
  }
}

export function fmtVarDriver(v: number | null | undefined, unidade: UnidadeDriver): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (emPontos(unidade)) return `${v > 0 ? "+" : ""}${v.toFixed(2)} pp`;
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function corVar(v: number | null | undefined): string {
  if (v == null) return "text-term-dim";
  return v > 0 ? "text-term-up" : v < 0 ? "text-term-down" : "text-term-dim";
}

export function CartaoDriver({ d, voto }: { d: DriverBody; voto: VotoDriver | undefined }) {
  const m = d.medida;
  const mensal = d.cadencia === "mensal";
  const dados = useMemo(() => d.pontos.map((p) => ({ date: p.date, valor: p.valor })), [d.pontos]);
  const chipVoto = voto && voto.direcao !== 0
    ? voto.aFavor === true
      ? { texto: "a favor", cls: "bg-term-up/15 text-term-up" }
      : voto.aFavor === false
        ? { texto: "contra", cls: "bg-term-down/15 text-term-down" }
        : { texto: voto.direcao === 1 ? "empurra ↑" : "empurra ↓", cls: "bg-term-panel2 text-term-text" }
    : { texto: mensal ? "mensal" : "sem voto", cls: "bg-term-panel2 text-term-dim" };
  return (
    <div className="rounded border border-term-line bg-term-panel2/40 p-2 min-w-0 space-y-1">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="font-bold text-term-text truncate" title={d.descricao}>{d.nome}</div>
          <div className="text-term-dim truncate" title={d.porQue}>{d.porQue}</div>
        </div>
        <span className={clsx("tag whitespace-nowrap", chipVoto.cls)} title={voto?.motivo ?? "sem medida"}>{chipVoto.texto}</span>
      </div>
      <div className="h-20">
        {dados.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dados} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#0b0f17", border: "1px solid #232a36", fontSize: 10 }}
                labelFormatter={(l) => fmtDateBR(String(l))}
                formatter={(v) => [fmtValorDriver(Number(v), d.unidade), d.nome]}
              />
              <Line type="monotone" dataKey="valor" stroke={mensal ? "#f5c451" : "#22d3ee"} strokeWidth={1.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-term-dim">{d.erro ?? "sem série"}</div>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono font-bold text-term-text">{fmtValorDriver(m.ultimo, d.unidade)}</span>
        <span className="text-term-dim whitespace-nowrap">{m.dataUltimo ? fmtDateBR(m.dataUltimo) : "—"}</span>
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        <span className={clsx("tag", d.stale ? "bg-term-gold/15 text-term-gold" : "bg-term-panel2 text-term-dim")} title={d.stale ? `disco vencido: ${d.erro ?? ""}` : `${FONTE_ROTULO[d.fonte]} · ${d.simbolo}`}>
          {FONTE_ROTULO[d.fonte] ?? d.fonte}{d.stale ? " · STALE" : ""}
        </span>
        {d.proxyDe && <span className="tag bg-term-gold/15 text-term-gold" title={`proxy de ${d.proxyDe}`}>proxy</span>}
        {m.z != null && Math.abs(m.z) >= 1 && <span className="tag bg-term-panel2 text-term-text" title="nível atual contra a média e o desvio dos últimos 252 pregões (24 meses se mensal)">z {m.z.toFixed(1)}</span>}
      </div>
      {mensal ? (
        <div className="font-mono text-term-dim">
          3m <span className={corVar(m.var3m)}>{fmtVarDriver(m.var3m, d.unidade)}</span> · 12m <span className={corVar(m.var12m)}>{fmtVarDriver(m.var12m, d.unidade)}</span>
        </div>
      ) : (
        <>
          <div className="font-mono text-term-dim">
            21p <span className={corVar(m.var21)}>{fmtVarDriver(m.var21, d.unidade)}</span> · 63p <span className={corVar(m.var63)}>{fmtVarDriver(m.var63, d.unidade)}</span> · 252p <span className={corVar(m.var252)}>{fmtVarDriver(m.var252, d.unidade)}</span>
          </div>
          <div className="font-mono text-term-dim" title={m.ate ? `${m.pares} pares de retornos até ${fmtDateBR(m.ate)}` : "sem pares suficientes"}>
            {m.corr != null && m.beta != null ? `corr ${m.corr.toFixed(2)} · β ${m.beta.toFixed(2)}` : `sem correlação (${m.pares} pares)`}
          </div>
        </>
      )}
    </div>
  );
}
