"use client";

import { useEffect, useMemo, useState } from "react";
import { useSnapshots, getIvRank, snapshotCount } from "@/lib/snapshots";
import { MIN_OBSERVACOES } from "@/lib/iv-rank";

/**
 * WO-50 — o único IV rank da plataforma.
 *
 * Lê do banco (`POST /api/iv-historico`, vários papéis numa chamada) com cache de 5 minutos por
 * (ticker, IV). Quando o banco não está configurado, cai para os snapshots do navegador — o
 * mesmo percentil, sobre a amostra que houver — e diz de onde veio. Antes, cinco componentes
 * liam só o navegador e o número mudava conforme a aba.
 */

export interface LeituraIvRank {
  ivRank: number | null;
  observacoes: number;
  fonte: "banco" | "navegador" | null;
  minimo: number;
  carregando: boolean;
}

interface Item {
  ticker: string;
  iv: number | null;
}

interface RankBanco {
  ivRank: number | null;
  observacoes: number;
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { em: number; valor: RankBanco }>();
/** `null` = ainda não perguntamos; `false` = a rota respondeu "sem banco" — não insistir. */
let bancoDisponivel: boolean | null = null;

const chaveDe = (i: Item) => `${i.ticker}|${i.iv != null ? i.iv.toFixed(4) : "-"}`;

async function consultarBanco(itens: Item[]): Promise<Record<string, RankBanco> | null> {
  if (bancoDisponivel === false || itens.length === 0) return null;
  try {
    const res = await fetch("/api/iv-historico", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itens }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j?.configurado) {
      bancoDisponivel = false;
      return null;
    }
    bancoDisponivel = true;
    return (j.ranks ?? null) as Record<string, RankBanco> | null;
  } catch {
    return null;
  }
}

/** IV rank de vários papéis (Watchlist). Chave do resultado: ticker. */
export function useIvRanks(itens: Item[]): Record<string, LeituraIvRank> {
  const snapshots = useSnapshots((st) => st.snapshots);
  const [doBanco, setDoBanco] = useState<Record<string, RankBanco>>({});
  const [carregando, setCarregando] = useState(false);
  // A lista muda de identidade a cada render; a chave textual não.
  const assinatura = itens.map(chaveDe).join(",");

  useEffect(() => {
    if (bancoDisponivel === false) return;
    const agora = Date.now();
    const faltam = itens.filter((i) => i.iv != null && !(cache.get(chaveDe(i)) && agora - cache.get(chaveDe(i))!.em < TTL_MS));
    // O que já está em cache entra na hora.
    const prontos: Record<string, RankBanco> = {};
    for (const i of itens) {
      const c = cache.get(chaveDe(i));
      if (c && agora - c.em < TTL_MS) prontos[i.ticker] = c.valor;
    }
    if (Object.keys(prontos).length) setDoBanco((prev) => ({ ...prev, ...prontos }));
    if (faltam.length === 0) return;
    let vivo = true;
    setCarregando(true);
    void consultarBanco(faltam).then((ranks) => {
      if (!vivo) return;
      setCarregando(false);
      if (!ranks) return;
      const em = Date.now();
      for (const i of faltam) {
        const r = ranks[i.ticker];
        if (r) cache.set(chaveDe(i), { em, valor: r });
      }
      setDoBanco((prev) => ({ ...prev, ...ranks }));
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  return useMemo(() => {
    const out: Record<string, LeituraIvRank> = {};
    for (const i of itens) {
      const b = bancoDisponivel !== false ? doBanco[i.ticker] : undefined;
      if (b) {
        out[i.ticker] = { ivRank: i.iv != null ? b.ivRank : null, observacoes: b.observacoes, fonte: "banco", minimo: MIN_OBSERVACOES, carregando: false };
      } else {
        const n = snapshotCount(snapshots, i.ticker);
        out[i.ticker] = {
          ivRank: i.iv != null ? getIvRank(snapshots, i.ticker, i.iv) : null,
          observacoes: n,
          fonte: n > 0 ? "navegador" : null,
          minimo: MIN_OBSERVACOES,
          carregando: carregando && bancoDisponivel !== false,
        };
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, doBanco, snapshots, carregando]);
}

/** IV rank de um papel. */
export function useIvRank(ticker: string | null, iv: number | null): LeituraIvRank {
  const itens = useMemo(() => (ticker ? [{ ticker, iv }] : []), [ticker, iv]);
  const r = useIvRanks(itens);
  return ticker && r[ticker] ? r[ticker] : { ivRank: null, observacoes: 0, fonte: null, minimo: MIN_OBSERVACOES, carregando: false };
}

export interface PontoSerieIv {
  data: string;
  atmIvMean: number | null;
  atmIvCall: number | null;
  atmIvPut: number | null;
  hv21: number | null;
  spot: number | null;
}

/** Série diária de IV ATM do papel no banco (até 365 dias). Vazia sem banco. */
export function useSerieIv(ticker: string | null): { serie: PontoSerieIv[]; configurado: boolean | null } {
  const [estado, setEstado] = useState<{ serie: PontoSerieIv[]; configurado: boolean | null; ticker: string | null }>({ serie: [], configurado: null, ticker: null });
  useEffect(() => {
    if (!ticker || bancoDisponivel === false) return;
    let vivo = true;
    fetch(`/api/iv-historico?ticker=${encodeURIComponent(ticker)}&serie=1`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo) return;
        if (!j?.configurado) {
          bancoDisponivel = false;
          setEstado({ serie: [], configurado: false, ticker });
          return;
        }
        setEstado({ serie: Array.isArray(j.serie) ? j.serie : [], configurado: true, ticker });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [ticker]);
  return estado.ticker === ticker ? estado : { serie: [], configurado: estado.configurado };
}
