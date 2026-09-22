"use client";
import { useEffect, useMemo, useState } from "react";
import type { DriversBody } from "@/lib/drivers-calculos";

/**
 * WO-66 — Os drivers dos papéis com estrutura aberta, para o Portfolio. Uma chamada a
 * `/api/drivers?ticker=` por papel (só os do book, nunca o universo), memória por sessão,
 * refaz quando a lista de papéis muda. A rota já guarda em disco por 20 h: aqui é só o cliente.
 */

const memoria = new Map<string, DriversBody>();
const emCurso = new Map<string, Promise<DriversBody | null>>();

async function buscar(ticker: string): Promise<DriversBody | null> {
  const quente = memoria.get(ticker);
  if (quente) return quente;
  const andamento = emCurso.get(ticker);
  if (andamento) return andamento;
  const p = (async () => {
    try {
      const res = await fetch(`/api/drivers?ticker=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(90_000) });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error ?? `HTTP ${res.status}`);
      memoria.set(ticker, j as DriversBody);
      return j as DriversBody;
    } finally {
      emCurso.delete(ticker);
    }
  })();
  emCurso.set(ticker, p);
  return p;
}

export interface DriversDoBook {
  porPapel: Record<string, DriversBody>;
  erros: Record<string, string>;
  carregando: boolean;
}

export function useDriversDoBook(underlyings: string[]): DriversDoBook {
  const chave = useMemo(() => Array.from(new Set(underlyings.map((t) => t.toUpperCase()))).sort().join(","), [underlyings]);
  const [porPapel, setPorPapel] = useState<Record<string, DriversBody>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const tickers = chave ? chave.split(",") : [];
    let vivo = true;
    if (!tickers.length) {
      setPorPapel({});
      setErros({});
      setCarregando(false);
      return;
    }
    setCarregando(true);
    (async () => {
      const ok: Record<string, DriversBody> = {};
      const falhas: Record<string, string> = {};
      await Promise.all(
        tickers.map(async (t) => {
          try {
            const b = await buscar(t);
            if (b) ok[t] = b;
            else falhas[t] = "sem resposta";
          } catch (e: any) {
            falhas[t] = e?.message ?? "falha";
          }
        })
      );
      if (vivo) {
        setPorPapel(ok);
        setErros(falhas);
        setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [chave]);

  return { porPapel, erros, carregando };
}
