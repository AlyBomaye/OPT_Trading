"use client";

import { useCallback, useEffect, useState } from "react";
import { useMarket } from "@/store/market";
import type { EntradaRascunho, PernaRascunho, PlanoRascunho, Rascunho } from "@/lib/rascunhos";
import type { MotivoSaida } from "@/lib/boletas";

/**
 * WO-58 — os rascunhos de boleta, para a Boletagem (lista, edita, confirma, descarta) e para quem
 * cria (Estratégia, Portfolio). Confirmar ressincroniza o livro: a boleta agora existe.
 */

interface Resultado<T = Rascunho> {
  ok: boolean;
  mensagem: string | null;
  rascunho?: T;
}

async function chamar<T = any>(url: string, init?: RequestInit): Promise<{ res: Response; j: T | null }> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => null)) as T | null;
  return { res, j };
}

/** Cria um rascunho — sem listar. Para a Estratégia e o Portfolio, que só mandam. */
export async function criarRascunhoRemoto(entrada: EntradaRascunho): Promise<Resultado> {
  try {
    const { res, j } = await chamar<any>("/api/rascunhos", { method: "POST", body: JSON.stringify(entrada) });
    if (!res.ok || !j?.criado) return { ok: false, mensagem: j?.error ?? j?.aviso ?? `Rascunho recusado (${res.status}).` };
    return { ok: true, mensagem: null, rascunho: j.rascunho };
  } catch (e: any) {
    return { ok: false, mensagem: `Falha ao criar o rascunho: ${e?.message ?? "erro"}` };
  }
}

export function useRascunhos(estado: "pendente" | "confirmado" | "descartado" | "todos" = "pendente") {
  const sincronizarLivro = useMarket((st) => st.sincronizarLivro);
  const [rascunhos, setRascunhos] = useState<Rascunho[]>([]);
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { res, j } = await chamar<any>(`/api/rascunhos${estado === "todos" ? "" : `?estado=${estado}`}`);
      if (!res.ok || !j) {
        setErro(j?.aviso ?? `Falha (${res.status}).`);
        return;
      }
      setConfigurado(Boolean(j.configurado));
      setRascunhos(Array.isArray(j.rascunhos) ? j.rascunhos : []);
      setErro(null);
    } catch (e: any) {
      setErro(e?.message ?? "erro");
    } finally {
      setCarregando(false);
    }
  }, [estado]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const atualizar = useCallback(async (id: number, patch: { pernas?: PernaRascunho[]; motivoSaida?: MotivoSaida | null; nota?: string | null; plano?: PlanoRascunho | null }): Promise<Resultado> => {
    const { res, j } = await chamar<any>(`/api/rascunhos/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!res.ok || !j?.atualizado) return { ok: false, mensagem: j?.error ?? `Não atualizado (${res.status}).` };
    setRascunhos((ls) => ls.map((r) => (r.id === id ? j.rascunho : r)));
    return { ok: true, mensagem: null, rascunho: j.rascunho };
  }, []);

  const confirmar = useCallback(async (id: number): Promise<Resultado> => {
    const { res, j } = await chamar<any>(`/api/rascunhos/${id}?acao=confirmar`, { method: "POST" });
    if (!res.ok || !j?.confirmado) return { ok: false, mensagem: j?.error ?? `Não confirmado (${res.status}). Nada foi gravado.` };
    await sincronizarLivro();
    await recarregar();
    return { ok: true, mensagem: `${j.boletas?.length ?? 0} boleta(s) registrada(s).`, rascunho: j.rascunho };
  }, [recarregar, sincronizarLivro]);

  const descartar = useCallback(async (id: number): Promise<Resultado> => {
    const { res, j } = await chamar<any>(`/api/rascunhos/${id}?acao=descartar`, { method: "POST" });
    if (!res.ok || !j?.descartado) return { ok: false, mensagem: j?.error ?? `Não descartado (${res.status}).` };
    await recarregar();
    return { ok: true, mensagem: null, rascunho: j.rascunho };
  }, [recarregar]);

  return { rascunhos, configurado, carregando, erro, recarregar, atualizar, confirmar, descartar };
}
