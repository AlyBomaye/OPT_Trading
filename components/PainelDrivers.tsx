"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Wind } from "lucide-react";
import clsx from "clsx";
import { ventoDosDrivers, viesDaEstrutura, type DriversBody, type VentoDrivers } from "@/lib/drivers-calculos";
import { CartaoDriver } from "@/components/CartaoDriver";
import { fmtDateBR } from "@/lib/format";

/**
 * WO-64 — "O que move este papel": as 5 séries que explicam o ticker (WO-64 §3), 2 anos cada,
 * com fonte e data, quanto o papel as seguiu (correlação e beta em 252 pregões) e o vento contra
 * o viés da estrutura montada. Nada aqui é previsão; a projeção é a Fase 2.
 *
 * O vento sobe para a página (`onVento`), que o entrega ao semáforo e ao agente. A seção recolhe;
 * o estado vive na página (`estrategia-drivers-open`). O cartão é `CartaoDriver` (WO-66: o
 * Portfolio usa o mesmo).
 */

interface Props {
  ticker: string;
  /** `detected.bias` da estrutura montada; sem pernas, `null` (vento só informativo). */
  vies: string | null;
  aberto: boolean;
  onToggle: () => void;
  onVento?: (v: VentoDrivers | null) => void;
}

const COR_SITUACAO: Record<VentoDrivers["situacao"], string> = {
  ok: "bg-term-up/15 text-term-up border-term-up/40",
  atencao: "bg-term-gold/15 text-term-gold border-term-gold/40",
  fora: "bg-term-down/15 text-term-down border-term-down/40",
  indefinido: "bg-term-panel2 text-term-dim border-term-line",
};
const ROTULO_SITUACAO: Record<VentoDrivers["situacao"], string> = { ok: "a favor", atencao: "misto", fora: "contra", indefinido: "só leitura" };

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
                  <CartaoDriver key={d.codigo} d={d} voto={votos.get(d.codigo)} />
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
