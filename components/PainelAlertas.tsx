"use client";

/**
 * WO-52 — o Cockpit avisa.
 *
 * Deriva os alertas do estado da tela (`avaliarAlertas`), guarda o "visto" por dia neste
 * navegador e, se o trader permitir, dispara um aviso do navegador uma vez por alerta novo.
 * Sem permissão, a lista continua na tela — o aviso é conveniência, a lista é o registro.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Check, AlertTriangle, AlertCircle, Info } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { useDividends } from "@/lib/dividends";
import { evaluateFlags, useFlagSettings } from "@/lib/position-flags";
import { avaliarAlertas, type Alerta } from "@/lib/alertas";
import { useSkewAtm } from "@/lib/hooks/useSkewAtm";
import { usePersistedState } from "@/lib/use-persisted-state";
import { sessionInfo } from "@/lib/session";

interface Props {
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
}

/** Chaves já avisadas nesta sessão do navegador — um aviso por alerta, não por render. */
const avisados = new Set<string>();

export function PainelAlertas({ gammaFlip, callWall, putWall }: Props) {
  const { chain, ticker, positions, chainCache, capitalTotal, selic } = useMarket();
  const divsByTicker = useDividends((st) => st.byTicker);
  const thresholds = useFlagSettings((st) => st.thresholds);
  const { skew } = useSkewAtm();
  const hoje = sessionInfo().ultimaSessao;
  const [vistos, setVistos] = usePersistedState<{ data: string; chaves: string[] }>("cockpit-alertas-vistos", { data: hoje, chaves: [] });
  const [permissao, setPermissao] = useState<NotificationPermission | "indisponivel">("default");

  useEffect(() => {
    setPermissao(typeof window !== "undefined" && "Notification" in window ? Notification.permission : "indisponivel");
  }, []);

  const flags = useMemo(
    () => evaluateFlags(positions, chainCache, divsByTicker, capitalTotal, thresholds, {}, selic),
    [positions, chainCache, divsByTicker, capitalTotal, thresholds, selic]
  );

  const alertas = useMemo(
    () =>
      avaliarAlertas({
        ticker,
        spot: chain?.spot ?? null,
        gammaFlip,
        callWall,
        putWall,
        skewRatio: skew?.ratio ?? null,
        skewSignal: skew?.signal ?? null,
        flags,
      }),
    [ticker, chain?.spot, gammaFlip, callWall, putWall, skew?.ratio, skew?.signal, flags]
  );

  // "Visto" vale por pregão: dia novo, lista limpa.
  const vistosHoje = vistos.data === hoje ? vistos.chaves : [];
  const pendentes = alertas.filter((a) => !vistosHoje.includes(a.chave));

  useEffect(() => {
    if (permissao !== "granted") return;
    for (const a of pendentes) {
      if (a.severidade === "info" || avisados.has(a.chave)) continue;
      avisados.add(a.chave);
      try {
        new Notification(a.titulo, { body: a.detalhe, tag: a.chave });
      } catch {
        /* alguns navegadores só permitem via service worker; a lista na tela basta */
      }
    }
  }, [pendentes, permissao]);

  const marcarVisto = (chave: string) => setVistos({ data: hoje, chaves: [...vistosHoje, chave] });
  const marcarTodos = () => setVistos({ data: hoje, chaves: alertas.map((a) => a.chave) });
  const pedirPermissao = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setPermissao(p);
  };

  const urgentes = pendentes.filter((a) => a.severidade === "urgente").length;

  return (
    <div id="alertas" className={clsx("panel border-l-2", urgentes > 0 ? "!border-l-term-down" : pendentes.length > 0 ? "!border-l-term-gold" : "!border-l-term-line")}>
      <div className="panel-title flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Bell size={14} className={urgentes > 0 ? "text-term-down" : "text-term-cyan"} />
          <span className="font-bold">Alertas do dia</span>
          <span className="tag bg-term-panel2 text-term-dim">
            {pendentes.length} pendente(s){urgentes > 0 ? ` · ${urgentes} urgente(s)` : ""} · {alertas.length - pendentes.length} visto(s)
          </span>
        </span>
        <span className="flex items-center gap-2 text-xxs">
          {permissao === "granted" ? (
            <span className="text-term-up flex items-center gap-1" title="Alertas urgentes e de atenção disparam um aviso do navegador, uma vez cada"><Bell size={11} /> avisos ativos</span>
          ) : permissao === "indisponivel" ? (
            <span className="text-term-dim flex items-center gap-1"><BellOff size={11} /> sem avisos neste navegador</span>
          ) : (
            <button className="btn text-xxs !py-0.5 !px-2 flex items-center gap-1" onClick={() => void pedirPermissao()} title="Permitir avisos do navegador para alertas novos">
              <Bell size={11} /> Ativar avisos
            </button>
          )}
          {pendentes.length > 0 && (
            <button className="btn text-xxs !py-0.5 !px-2" onClick={marcarTodos}>marcar todos vistos</button>
          )}
        </span>
      </div>
      <div className="px-3 pb-2 space-y-1">
        {alertas.length === 0 && (
          <div className="text-xxs text-term-dim py-1">Nada a avisar: spot longe dos walls e do flip, skew neutro, book sem flag urgente ou de atenção.</div>
        )}
        {pendentes.map((a) => (
          <LinhaAlerta key={a.chave} a={a} onVisto={() => marcarVisto(a.chave)} />
        ))}
        {alertas.length > pendentes.length && (
          <details className="text-xxs text-term-dim">
            <summary className="cursor-pointer">vistos hoje ({alertas.length - pendentes.length})</summary>
            <div className="space-y-1 pt-1 opacity-70">
              {alertas.filter((a) => vistosHoje.includes(a.chave)).map((a) => <LinhaAlerta key={a.chave} a={a} />)}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function LinhaAlerta({ a, onVisto }: { a: Alerta; onVisto?: () => void }) {
  const Icone = a.severidade === "urgente" ? AlertTriangle : a.severidade === "atencao" ? AlertCircle : Info;
  const cor = a.severidade === "urgente" ? "text-term-down" : a.severidade === "atencao" ? "text-term-gold" : "text-term-cyan";
  return (
    <div className="flex items-start gap-2 text-xs border-t border-term-line/40 pt-1">
      <Icone size={13} className={clsx("shrink-0 mt-0.5", cor)} />
      <div className="flex-1 min-w-0">
        <Link href={a.deepLink} className={clsx("font-semibold hover:underline", cor)}>{a.titulo}</Link>
        <div className="text-xxs text-term-dim leading-relaxed">{a.detalhe}</div>
      </div>
      {onVisto && (
        <button className="text-term-dim hover:text-term-up shrink-0" title="Marcar como visto hoje" onClick={onVisto}>
          <Check size={13} />
        </button>
      )}
    </div>
  );
}
