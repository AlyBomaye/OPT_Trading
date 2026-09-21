"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Wind } from "lucide-react";
import clsx from "clsx";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { emPontos, ventoDosDrivers, viesDaEstrutura, type DriverBody, type DriversBody, type VentoDrivers, type VotoDriver } from "@/lib/drivers-calculos";
import type { UnidadeDriver } from "@/lib/drivers-catalogo";
import { fmtDateBR, fmtNum } from "@/lib/format";

/**
 * WO-64 — "O que move este papel": as 5 séries que explicam o ticker (WO-64 §3), 2 anos cada,
 * com fonte e data, quanto o papel as seguiu (correlação e beta em 252 pregões) e o vento contra
 * o viés da estrutura montada. Nada aqui é previsão; a projeção é a Fase 2.
 *
 * O vento sobe para a página (`onVento`), que o entrega ao semáforo e ao agente. A seção recolhe;
 * o estado vive na página (`estrategia-drivers-open`).
 */

interface Props {
  ticker: string;
  /** `detected.bias` da estrutura montada; sem pernas, `null` (vento só informativo). */
  vies: string | null;
  aberto: boolean;
  onToggle: () => void;
  onVento?: (v: VentoDrivers | null) => void;
}

const FONTE_ROTULO: Record<string, string> = { mt5: "MT5", yahoo: "Yahoo", bcb: "BCB" };
const COR_SITUACAO: Record<VentoDrivers["situacao"], string> = {
  ok: "bg-term-up/15 text-term-up border-term-up/40",
  atencao: "bg-term-gold/15 text-term-gold border-term-gold/40",
  fora: "bg-term-down/15 text-term-down border-term-down/40",
  indefinido: "bg-term-panel2 text-term-dim border-term-line",
};
const ROTULO_SITUACAO: Record<VentoDrivers["situacao"], string> = { ok: "a favor", atencao: "misto", fora: "contra", indefinido: "só leitura" };

function fmtValor(v: number | null | undefined, unidade: UnidadeDriver): string {
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

function fmtVar(v: number | null | undefined, unidade: UnidadeDriver): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (emPontos(unidade)) return `${v > 0 ? "+" : ""}${v.toFixed(2)} pp`;
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function corVar(v: number | null | undefined): string {
  if (v == null) return "text-term-dim";
  return v > 0 ? "text-term-up" : v < 0 ? "text-term-down" : "text-term-dim";
}

function Cartao({ d, voto }: { d: DriverBody; voto: VotoDriver | undefined }) {
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
                formatter={(v) => [fmtValor(Number(v), d.unidade), d.nome]}
              />
              <Line type="monotone" dataKey="valor" stroke={mensal ? "#f5c451" : "#22d3ee"} strokeWidth={1.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-term-dim">{d.erro ?? "sem série"}</div>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono font-bold text-term-text">{fmtValor(m.ultimo, d.unidade)}</span>
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
          3m <span className={corVar(m.var3m)}>{fmtVar(m.var3m, d.unidade)}</span> · 12m <span className={corVar(m.var12m)}>{fmtVar(m.var12m, d.unidade)}</span>
        </div>
      ) : (
        <>
          <div className="font-mono text-term-dim">
            21p <span className={corVar(m.var21)}>{fmtVar(m.var21, d.unidade)}</span> · 63p <span className={corVar(m.var63)}>{fmtVar(m.var63, d.unidade)}</span> · 252p <span className={corVar(m.var252)}>{fmtVar(m.var252, d.unidade)}</span>
          </div>
          <div className="font-mono text-term-dim" title={m.ate ? `${m.pares} pares de retornos até ${fmtDateBR(m.ate)}` : "sem pares suficientes"}>
            {m.corr != null && m.beta != null ? `corr ${m.corr.toFixed(2)} · β ${m.beta.toFixed(2)}` : `sem correlação (${m.pares} pares)`}
          </div>
        </>
      )}
    </div>
  );
}

export function PainelDrivers({ ticker, vies, aberto, onToggle, onVento }: Props) {
  const [body, setBody] = useState<DriversBody | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    (async () => {
      try {
        const res = await fetch(`/api/drivers?ticker=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(90_000) });
        const j = await res.json();
        if (!vivo) return;
        if (!res.ok) {
          setBody(null);
          setErro(j?.error ?? `HTTP ${res.status}`);
        } else setBody(j as DriversBody);
      } catch (e: any) {
        if (vivo) {
          setBody(null);
          setErro(e?.message ?? "falha ao buscar os drivers");
        }
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [ticker]);

  const vento = useMemo(
    () => (body ? ventoDosDrivers(body.drivers.map((d) => ({ codigo: d.codigo, nome: d.nome, cadencia: d.cadencia, medida: d.medida })), viesDaEstrutura(vies)) : null),
    [body, vies]
  );
  useEffect(() => {
    onVento?.(vento);
  }, [vento, onVento]);

  const votos = useMemo(() => new Map((vento?.votos ?? []).map((v) => [v.codigo, v])), [vento]);

  return (
    <div className="panel">
      <div onClick={onToggle} className="panel-title flex items-center justify-between cursor-pointer select-none gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Wind size={14} className="text-term-cyan" />
          <span className="font-bold">O que move este papel — {ticker}</span>
          <span className="text-xxs text-term-dim font-normal hidden md:inline">as 5 séries que explicam boa parte do preço, medidas contra ele · 2 anos</span>
        </div>
        {carregando ? (
          <span className="tag bg-term-panel2 text-term-dim">buscando…</span>
        ) : vento ? (
          <span className={clsx("tag border whitespace-nowrap", COR_SITUACAO[vento.situacao])} title={vento.resumo}>
            vento {ROTULO_SITUACAO[vento.situacao]}{vento.vies !== "NEUTRA" ? ` · ${vento.aFavor} a favor · ${vento.contra} contra` : ` · ${vento.emMovimento} em movimento`}
          </span>
        ) : erro ? (
          <span className="tag bg-term-down/15 text-term-down">{erro}</span>
        ) : null}
      </div>
      {aberto && (
        <div className="px-2 pb-2 space-y-2 text-xxs">
          {erro && !body && <div className="text-term-down">{erro}</div>}
          {body && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {body.drivers.map((d) => (
                  <Cartao key={d.codigo} d={d} voto={votos.get(d.codigo)} />
                ))}
              </div>
              <div className="text-term-dim flex flex-wrap gap-x-3 gap-y-0.5">
                <span>
                  medido contra {body.papel.fonte ?? "—"} · {body.papel.pontos} fechamentos{body.papel.de && body.papel.ate ? ` de ${fmtDateBR(body.papel.de)} a ${fmtDateBR(body.papel.ate)}` : ""}
                </span>
                <span>correlação e beta em 252 pregões · vento em {vento?.janela ?? 21} pregões · mensais informam, não votam</span>
                <span>DI: contratos jan/28 e jan/31 fixos, rolados em janeiro</span>
                <span className="text-term-gold">nada aqui é previsão — a projeção é a Fase 2 da WO-64</span>
                {body.papel.erro && <span className="text-term-down">{body.papel.erro}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
