"use client";

import { useCallback, useEffect, useState } from "react";
import type { AtivoHistorico, RespostaUniverso } from "@/app/api/history/universo/route";
import type { MarcacaoRegime } from "@/lib/regime-calculos";

/**
 * WO-59 — os dados da Chart Attack, para o cliente. Três hooks, três chamadas ao montar:
 *
 *   - `useHistoricoUniverso()` → `/api/history/universo` (31 históricos do cache em disco);
 *   - `useRegimesVigentes()`   → `/api/regime` (a marcação vigente de cada ativo, feita pelo operador);
 *
 * Os tickers com posição vêm do store (`useMarket().positions`), não daqui.
 * Nada aqui toca disco nem banco — só tipos da rota.
 */

export function useHistoricoUniverso() {
  const [ativos, setAtivos] = useState<Record<string, AtivoHistorico>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [resumo, setResumo] = useState<{ deCache: number; daRede: number; falhas: number } | null>(null);

  const recarregar = useCallback(async (forcar = false) => {
    setCarregando(true);
    try {
      const res = await fetch(`/api/history/universo${forcar ? "?forcar=1" : ""}`, { signal: AbortSignal.timeout(120_000) });
      const j = (await res.json().catch(() => null)) as RespostaUniverso | null;
      if (!res.ok || !j || !Array.isArray(j.ativos)) {
        // ANTIGRAVITY regra 13: erro não zera a tela — o que já estava fica, com o aviso.
        setErro(`A rota do histórico falhou (${res.status}). Mantendo o que já estava na tela.`);
        return;
      }
      const mapa: Record<string, AtivoHistorico> = {};
      for (const a of j.ativos) mapa[a.ticker] = a;
      setAtivos(mapa);
      setGeradoEm(j.geradoEm);
      setResumo({ deCache: j.deCache, daRede: j.daRede, falhas: j.falhas });
      setErro(null);
    } catch (e: any) {
      setErro(`Sem resposta do histórico: ${e?.message ?? "erro"}. Mantendo o que já estava na tela.`);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar(false);
  }, [recarregar]);

  return { ativos, carregando, erro, geradoEm, resumo, recarregar };
}

export function useRegimesVigentes() {
  const [regimes, setRegimes] = useState<Record<string, MarcacaoRegime>>({});
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch("/api/regime", { signal: AbortSignal.timeout(15_000) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) return;
      setConfigurado(j.configurado !== false);
      setRegimes(j.regimes && typeof j.regimes === "object" ? j.regimes : {});
    } catch {
      /* sem banco ou sem rede: fica sem marcação, e a tela diz "sem marcação" */
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { regimes, configurado, carregando, recarregar };
}
