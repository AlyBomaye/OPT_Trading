"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { americanGreeks, americanImpliedVol, bsGreeks, impliedVol, type Greeks } from "@/lib/black-scholes";
import { adjustedSpot, effectiveDividends, useDividends } from "@/lib/dividends";
import { snapshotFromChain, useSnapshots } from "@/lib/snapshots";
import { sessionInfo, sessionsBetween } from "@/lib/session";
import { resumirCobertura, spotParaPremio } from "@/lib/provenance";
import type { DividendEvent } from "@/lib/universe";
import type { ChainData, ExpiryInfo, Leg, OptionQuote, Position } from "@/lib/types";

export const MAX_SESSOES_OK = 3;

interface ApiRow {
  opTicker: string;
  type: "CALL" | "PUT";
  model: "A" | "E";
  moneyness: "ITM" | "ATM" | "OTM" | null;
  strike: number;
  distStrikePct: number | null;
  premioPctCot: number | null;
  last: number | null;
  trades: number | null;
  volumeFin: number | null;
  lastTradeAt: string | null;
  sourceIv: number | null;
  sourceDelta: number | null;
  expiry: string;
  du: number;
  dte: number;
}

interface ApiBody {
  ticker: string;
  spot: number | null;
  updatedAt: string;
  fetchedAt?: string;
  dataEfetiva?: string | null;
  dataMaisRecente?: string | null;
  expiries: ExpiryInfo[];
  options: ApiRow[];
  sourceGreeksAvailable: boolean;
  error?: string;
}

// WO-22: Store persistido do último chain bom por ticker (máximo 5 tickers)
interface SnapshotState {
  byTicker: Record<string, { chain: ChainData; savedAt: string }>;
  saveSnapshot: (chain: ChainData) => void;
  getSnapshot: (ticker: string) => ChainData | null;
}

export const useChainSnapshot = create<SnapshotState>()(
  persist(
    (set, get) => ({
      byTicker: {},
      saveSnapshot: (chain) => {
        const ticker = chain.ticker;
        set((st) => {
          const next = { ...st.byTicker, [ticker]: { chain, savedAt: new Date().toISOString() } };
          const keys = Object.keys(next);
          if (keys.length > 5) {
            const sorted = keys.sort((a, b) => (next[a].savedAt > next[b].savedAt ? 1 : -1));
            delete next[sorted[0]];
          }
          return { byTicker: next };
        });
      },
      getSnapshot: (ticker) => get().byTicker[ticker]?.chain ?? null,
    }),
    { name: "chain-snapshot", version: 1 }
  )
);

// WO-12: memoização do pricing americano por (opTicker, last, spot, r)
const amCache = new Map<string, { iv: number | null; greeks: Greeks | null }>();

/**
 * Enriquece o chain com IV (Newton-Raphson) e gregas calculadas localmente.
 *
 * WO-30 §2.3 — REGRA CENTRAL: a IV de uma série é extraída com o spot da MESMA data do
 * prêmio. Misturar spot de hoje com prêmio de outro pregão produz uma IV que não existe,
 * e todo derivado (gregas, smile, skew, IV Rank, GEX, sugestões) herda o erro em silêncio.
 * Sem fechamento para a data do prêmio, `iv` e as gregas ficam null — a tela mostra `—`.
 *
 * @param spot       spot de referência corrente (pode ser override do usuário)
 * @param spotDate   data à qual `spot` se refere (null quando é override manual)
 * @param closesByDate fechamentos históricos por data, para casar prêmios antigos
 */
function enrich(
  body: ApiBody,
  spot: number,
  r: number,
  divs: DividendEvent[] = [],
  refSessionDate?: string,
  spotDate?: string | null,
  closesByDate: Record<string, number> = {}
): ChainData {
  const sess = sessionInfo();
  const refSession = refSessionDate ?? sess.ultimaSessao;

  // Memo por (spotBase, expiry): o ajuste por proventos depende dos dois.
  const spotByKey = new Map<string, number>();
  const spotFor = (base: number, expiry: string): number => {
    const key = `${base}|${expiry}`;
    let s = spotByKey.get(key);
    if (s == null) {
      s = divs.length ? adjustedSpot(base, divs, r, expiry) : base;
      spotByKey.set(key, s);
    }
    return s;
  };

  const cobertura = resumirCobertura(body.options, body.dataEfetiva);

  const options: OptionQuote[] = body.options.map((o) => {
    const t = o.du / 252;
    const premiumDate = o.lastTradeAt ? o.lastTradeAt.slice(0, 10) : null;

    // Spot casado com a data do prêmio (WO-30 §2.3)
    const { spot: spotBase, ivSpotDate } = spotParaPremio({
      premiumDate,
      spotDate: spotDate ?? null,
      spotCorrente: spot,
      closesByDate,
    });

    // Para checagens de sanidade (intrínseco) usa-se o spot casado; sem ele, o corrente.
    const sAdj = spotFor(spotBase ?? spot, o.expiry);
    const intrinsic = o.type === "CALL" ? Math.max(sAdj - o.strike, 0) : Math.max(o.strike - sAdj, 0);

    // WO-22: Qualidade da marcação por idade real em sessões (lastTradeAt da B3)
    const tradeAgeSessions = o.lastTradeAt
      ? sessionsBetween(o.lastTradeAt, refSession)
      : (o.trades ?? 0) === 0
      ? 99
      : 0;

    let markQuality: OptionQuote["markQuality"] = "stale";
    if (
      o.last != null &&
      o.last > 0 &&
      (o.trades ?? 0) > 0 &&
      o.last >= intrinsic &&
      tradeAgeSessions <= MAX_SESSOES_OK
    ) {
      markQuality = tradeAgeSessions <= 1 ? "fresh" : "ok";
    }

    let iv: number | null = o.sourceIv != null ? o.sourceIv / 100 : null;
    let delta: number | null = null,
      gamma: number | null = null,
      theta: number | null = null,
      vega: number | null = null,
      rho: number | null = null;

    // WO-30 §2.3: sem spot casado com a data do prêmio, não há IV honesta a extrair.
    const podeCalcular = spotBase != null;

    if (!podeCalcular) {
      iv = null;
    } else if (o.model === "A" && t > 0 && o.last != null && o.last > 0) {
      const key = `${o.opTicker}|${o.last}|${sAdj.toFixed(4)}|${r}`;
      let hit = amCache.get(key);
      if (!hit) {
        const aIv = iv ?? americanImpliedVol(o.last, sAdj, o.strike, t, r, o.type, 0, 100);
        const g =
          aIv != null ? americanGreeks({ s: sAdj, k: o.strike, t, r, sigma: aIv }, o.type, 200) : null;
        hit = { iv: aIv, greeks: g };
        if (amCache.size > 8000) amCache.clear();
        amCache.set(key, hit);
      }
      iv = hit.iv;
      if (hit.greeks) {
        delta = hit.greeks.delta;
        gamma = hit.greeks.gamma;
        theta = hit.greeks.theta;
        vega = hit.greeks.vega;
        rho = hit.greeks.rho;
      }
    } else {
      if (iv == null && o.last != null && o.last > 0 && t > 0) {
        iv = impliedVol(o.last, sAdj, o.strike, t, r, o.type);
      }
      if (iv != null && t > 0) {
        const g = bsGreeks({ s: sAdj, k: o.strike, t, r, sigma: iv }, o.type);
        delta = g.delta;
        gamma = g.gamma;
        theta = g.theta;
        vega = g.vega;
        rho = g.rho;
      }
    }
    return {
      opTicker: o.opTicker,
      underlying: body.ticker,
      type: o.type,
      model: o.model,
      moneyness: o.moneyness,
      strike: o.strike,
      distStrikePct: o.distStrikePct,
      premioPctCot: o.premioPctCot,
      last: o.last,
      trades: o.trades,
      volumeFin: o.volumeFin,
      lastTradeAt: o.lastTradeAt,
      ivSpotDate,
      ivSpotUsado: spotBase != null ? sAdj : null,
      tradeAgeSessions,
      expiry: o.expiry,
      du: o.du,
      dte: o.dte,
      markQuality,
      iv,
      delta,
      gamma,
      theta,
      vega,
      rho,
    };
  });

  return {
    ticker: body.ticker,
    spot,
    updatedAt: body.updatedAt,
    fetchedAt: body.fetchedAt ?? body.updatedAt,
    dataEfetiva: body.dataEfetiva,
    dataMaisRecente: body.dataMaisRecente,
    expiries: body.expiries,
    options,
    greeksComputedLocally: !body.sourceGreeksAvailable,
    spotDate: spotDate ?? null,
    cobertura,
  };
}

export interface OfficialSpotInfo {
  price: number;
  date: string;
}

interface MarketState {
  ticker: string;
  selic: number; // fração a.a.
  spotOverride: number | null;
  officialSpot: OfficialSpotInfo | null;
  useOfficialSpot: boolean;
  chain: ChainData | null;
  chainCache: Record<string, ChainData>;
  loading: boolean;
  error: string | null;
  selectedExpiry: string | null;
  legs: Leg[];
  positions: Position[];
  closed: Position[];
  capitalTotal: number;

  /**
   * WO-48 — estado do livro no banco. Com `configurado`, `positions`/`closed`/`capitalTotal` são
   * CACHE do que veio de /api/boletas; sem, são o que sempre foram (o navegador).
   */
  livro: {
    configurado: boolean;
    /** null = ainda não perguntou ao servidor. */
    consultadoEm: string | null;
    totalBoletas: number;
    aviso: string | null;
    caixa: { aportes: number; retiradas: number; debitos: number; creditos: number; custos: number; saldo: number } | null;
    estruturas: import("@/lib/boletas").EstruturaRegistrada[];
    boletas: import("@/lib/boletas").BoletaRegistrada[];
  };
  sincronizarLivro: () => Promise<void>;
  /**
   * Boletar (WO-48): grava as pernas como boletas `origem: workbench` e ressincroniza.
   * Devolve `{ ok:false, mensagem }` sem banco ou se o servidor recusar — nunca grava só local.
   */
  boletar: (
    ls: Leg[],
    plano?: Pick<Position, "tese" | "alvo" | "regraSaida" | "regimeNaEntrada">,
    executadoEm?: string
  ) => Promise<{ ok: boolean; mensagem: string | null }>;

  setTicker: (t: string) => void;
  setCapitalTotal: (v: number) => void;
  updatePosition: (id: string, patch: Partial<Position>) => void;
  setSelic: (r: number) => void;
  setSpotOverride: (s: number | null) => void;
  setUseOfficialSpot: (val: boolean) => void;
  setSelectedExpiry: (e: string) => void;
  refresh: (tickerArg?: string) => Promise<void>;

  addLeg: (l: Leg) => void;
  updateLeg: (id: string, patch: Partial<Leg>) => void;
  removeLeg: (id: string) => void;
  setLegs: (ls: Leg[]) => void;
  clearLegs: () => void;

  /**
   * Registra as pernas como posicoes abertas.
   *
   * `journal` carrega as 3 perguntas do metodo (tese, alvo, regra de saida) e o regime marcado
   * no momento da entrada. Sao gravadas na posicao, nao num diario separado, porque a pergunta
   * que importa depois e "o que eu disse que ia acontecer?" — e ela so tem resposta se estiver
   * presa a posicao. Opcional na assinatura para nao quebrar chamadas antigas (WO-46 §E.2).
   */
  openPositions: (ls: Leg[], journal?: Pick<Position, "tese" | "alvo" | "regraSaida" | "regimeNaEntrada">) => void;
  /**
   * Encerra uma perna. `motivoSaida` (WO-47 §5.4) registra QUAL regra disparou — alvo, stop,
   * regime, vencimento ou manual. É o que permite, depois, medir resultado por motivo.
   */
  closePosition: (id: string, closePrice: number, motivoSaida?: Position["motivoSaida"]) => void;
  /**
   * Encerra várias pernas de uma vez, cada uma ao seu preço, com o mesmo motivo (WO-47 §5.5).
   * Uma estrutura de quatro pernas deixa de exigir quatro diálogos.
   */
  closeStructure: (
    fechamentos: { id: string; closePrice: number }[],
    motivoSaida?: Position["motivoSaida"]
  ) => void;
  removePosition: (id: string) => void;
  initHydrate: () => void;
}

export const useMarket = create<MarketState>()(
  persist(
    (set, get) => ({
      ticker: "PETR4",
      selic: 0.15,
      spotOverride: null,
      officialSpot: null,
      useOfficialSpot: true,
      chain: null,
      chainCache: {},
      loading: false,
      error: null,
      selectedExpiry: null,
      legs: [],
      positions: [],
      closed: [],
      capitalTotal: 100_000,
      livro: { configurado: false, consultadoEm: null, totalBoletas: 0, aviso: null, caixa: null, estruturas: [], boletas: [] },

      sincronizarLivro: async () => {
        try {
          const res = await fetch("/api/boletas", { signal: AbortSignal.timeout(20_000) });
          const j = await res.json().catch(() => null);
          if (!j || j.configurado !== true) {
            set((st) => ({ livro: { ...st.livro, configurado: false, consultadoEm: new Date().toISOString(), aviso: j?.aviso ?? "Banco indisponível — somente-leitura com o cache." } }));
            return;
          }
          // Livro vazio no banco = ainda não migrado: NÃO sobrescreve o cache do navegador, senão
          // a migração não teria de onde ler. A tela oferece a migração.
          if (j.totalBoletas === 0) {
            set((st) => ({ livro: { ...st.livro, configurado: true, consultadoEm: new Date().toISOString(), totalBoletas: 0, aviso: null, caixa: j.caixa, estruturas: [], boletas: [] } }));
            return;
          }
          set({
            positions: j.posicoes,
            closed: j.fechadas,
            capitalTotal: Math.max(0, Number(j.caixa?.saldo ?? 0)),
            livro: { configurado: true, consultadoEm: new Date().toISOString(), totalBoletas: j.totalBoletas, aviso: null, caixa: j.caixa, estruturas: j.estruturas, boletas: j.boletas },
          });
        } catch (e: any) {
          set((st) => ({ livro: { ...st.livro, consultadoEm: new Date().toISOString(), aviso: `Não foi possível ler o livro: ${e?.message ?? "erro"}` } }));
        }
      },

      boletar: async (ls, plano, executadoEm) => {
        const st = get();
        if (!st.livro.configurado) {
          return { ok: false, mensagem: "Boletar exige o banco (WO-48): rode npm run setup:db. Nada foi gravado — a plataforma não guarda boleta só no navegador." };
        }
        if (ls.length === 0) return { ok: false, mensagem: "Sem pernas para boletar." };
        const quando = executadoEm ?? new Date().toISOString();
        const chain = st.chainCache[ls[0].underlying] ?? st.chain;
        const boletas = ls.map((l, i) => {
          const o = l.kind === "OPTION" && chain?.ticker === l.underlying ? chain.options.find((x) => x.opTicker === l.opTicker) : undefined;
          return {
            tipo: "abertura",
            origem: "workbench",
            executadoEm: quando,
            ticker: l.underlying,
            kind: l.kind,
            opTicker: l.kind === "OPTION" ? l.opTicker ?? null : null,
            tipoOpcao: l.type ?? null,
            modelo: l.model ?? null,
            strike: l.strike ?? null,
            vencimento: l.expiry ?? null,
            lado: l.side,
            quantidade: Math.abs(l.qty),
            preco: l.price,
            ivEntrada: l.iv ?? null,
            gregasEntrada: o ? { delta: o.delta, vega: o.vega, theta: o.theta } : l.kind === "STOCK" ? { delta: 1, vega: 0, theta: 0 } : null,
            // A primeira perna cria a estrutura com o plano; as demais entram nela pelo id
            // devolvido — o servidor processa em ordem e o cliente encadeia.
            ...(i === 0 ? { novaEstrutura: { tese: plano?.tese ?? null, alvo: plano?.alvo ?? null, regraSaida: plano?.regraSaida ?? null, regimeEntrada: plano?.regimeNaEntrada ?? null } } : {}),
          };
        });
        try {
          // Encadeia: primeira boleta cria a estrutura; as seguintes recebem estruturaId.
          let estruturaId: number | null = null;
          for (const b of boletas) {
            const corpo: Record<string, unknown> = estruturaId != null ? { ...b, estruturaId } : b;
            const res: Response = await fetch("/api/boletas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(20_000) });
            const j: any = await res.json().catch(() => null);
            if (!res.ok || !j?.gravado) {
              await get().sincronizarLivro();
              return { ok: false, mensagem: j?.error ?? j?.aviso ?? `Boleta recusada (${res.status}).` };
            }
            const devolvido = j?.resultados?.[0]?.estruturaId;
            if (typeof devolvido === "number") estruturaId = devolvido;
          }
          await get().sincronizarLivro();
          return { ok: true, mensagem: null };
        } catch (e: any) {
          return { ok: false, mensagem: `Falha ao boletar: ${e?.message ?? "erro"}` };
        }
      },

      initHydrate: () => {
        const { chain, ticker } = get();
        if (chain == null) {
          const snap = useChainSnapshot.getState().getSnapshot(ticker);
          if (snap) {
            const validExpiry = snap.expiries.find((e) => e.isMonthly)?.date ?? snap.expiries[0]?.date ?? null;
            set({ chain: snap, chainCache: { [ticker]: snap }, selectedExpiry: validExpiry });
          }
        }
      },

      setTicker: (t) => {
        const nextTicker = t.toUpperCase();
        set({ ticker: nextTicker, chain: null, spotOverride: null, officialSpot: null, selectedExpiry: null });
        get().initHydrate();
        void get().refresh();
      },
      setCapitalTotal: (v) => {
        // WO-48: com o livro no banco, o caixa vem das boletas (aporte/retirada). Editar aqui
        // criaria um segundo número — a tela desabilita o campo; isto é a rede de segurança.
        if (get().livro.configurado && get().livro.totalBoletas > 0) return;
        set({ capitalTotal: Math.max(0, v) });
      },
      updatePosition: (id, patch) =>
        set((st) => ({ positions: st.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      setSelic: (r) => {
        set({ selic: r });
        void get().refresh();
      },
      setSpotOverride: (s) => {
        set({ spotOverride: s });
        void get().refresh();
      },
      setUseOfficialSpot: (val) => {
        set({ useOfficialSpot: val });
        void get().refresh();
      },
      setSelectedExpiry: (e) => set({ selectedExpiry: e }),

      refresh: async (tickerArg?: string) => {
        const { ticker, selic, spotOverride, useOfficialSpot } = get();
        const target = (tickerArg ?? ticker).toUpperCase();
        const isActive = target === ticker;
        if (isActive) set({ loading: true, error: null });

        try {
          const res = await fetch(`/api/opcoes?ticker=${encodeURIComponent(target)}`);
          const body: ApiBody = await res.json();
          if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);

          // WO-22 + WO-30 §2.3: o histórico agora é sempre carregado, porque além do
          // fechamento oficial ele fornece o spot de CADA data — necessário para extrair a
          // IV de prêmios antigos sem misturar datas.
          const sess = sessionInfo();
          let officialSpot: OfficialSpotInfo | null = null;
          const closesByDate: Record<string, number> = {};

          try {
            const hRes = await fetch(`/api/history?ticker=${encodeURIComponent(target)}`);
            if (hRes.ok) {
              const hData = await hRes.json();
              const candles: Array<{ date: string; close: number }> = hData.candles ?? [];
              for (const c of candles) {
                if (c?.date && typeof c.close === "number") closesByDate[c.date] = c.close;
              }
              const lastCandle = candles[candles.length - 1];
              if (lastCandle) officialSpot = { price: lastCandle.close, date: lastCandle.date };
            }
          } catch {}

          // Prioridade de spot: spotOverride > (useOfficialSpot ? officialSpot : null) > body.spot
          let effectiveSpot: number | null = null;
          let effectiveSpotDate: string | null = null;
          if (isActive && spotOverride != null) {
            effectiveSpot = spotOverride;
            effectiveSpotDate = null; // override manual não tem data de mercado
          } else if (useOfficialSpot && officialSpot != null) {
            effectiveSpot = officialSpot.price;
            effectiveSpotDate = officialSpot.date;
          } else {
            effectiveSpot = body.spot;
            effectiveSpotDate = body.dataEfetiva ?? null;
          }

          if (effectiveSpot == null) throw new Error("Não foi possível derivar o spot do chain.");

          const divs = effectiveDividends(useDividends.getState().byTicker, target);
          const chain = enrich(
            body,
            effectiveSpot,
            selic,
            divs,
            sess.ultimaSessao,
            effectiveSpotDate,
            closesByDate
          );
          const cur = get().selectedExpiry;
          const validExpiry = chain.expiries.some((e) => e.date === cur)
            ? cur
            : chain.expiries.find((e) => e.isMonthly)?.date ?? chain.expiries[0]?.date ?? null;

          // Grava snapshot persistido no sucesso
          useChainSnapshot.getState().saveSnapshot(chain);

          set((st) => ({
            chainCache: { ...st.chainCache, [target]: chain },
            positions: st.positions.map((p) => {
              if (p.underlying !== target) return p;
              const m = markFromChain(p, chain);
              return m != null ? { ...p, lastMark: m, lastMarkAt: chain.updatedAt } : p;
            }),
            ...(isActive
              ? { chain, officialSpot, selectedExpiry: validExpiry, loading: false, error: null }
              : {}),
          }));

          useSnapshots.getState().upsert(snapshotFromChain(chain));
        } catch (e) {
          if (isActive) {
            const errStr = e instanceof Error ? e.message : String(e);
            // WO-22: NUNCA ZERAR A TELA EM ERRO. Mantém o chain atual (ou do snapshot)
            set((st) => {
              let existingChain = st.chain;
              if (existingChain == null) {
                existingChain = useChainSnapshot.getState().getSnapshot(target);
              }
              return {
                chain: existingChain,
                error: `Aviso: Falha na atualização do chain (${errStr}). Exibindo dados persistidos.`,
                loading: false,
              };
            });
          } else {
            throw e;
          }
        }
      },

      addLeg: (l) => set((st) => ({ legs: [...st.legs, l] })),
      updateLeg: (id, patch) =>
        set((st) => ({ legs: st.legs.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
      removeLeg: (id) => set((st) => ({ legs: st.legs.filter((l) => l.id !== id) })),
      setLegs: (ls) => set({ legs: ls }),
      clearLegs: () => set({ legs: [] }),

      openPositions: (ls, journal) =>
        set((st) => ({
          positions: [
            ...st.positions,
            ...ls.map((l) => {
              let entryGreeks: Position["entryGreeks"];
              if (l.kind === "STOCK") {
                entryGreeks = { delta: 1, vega: 0, theta: 0 };
              } else {
                const chain = st.chainCache[l.underlying] ?? st.chain;
                const o = chain?.ticker === l.underlying ? chain.options.find((x) => x.opTicker === l.opTicker) : undefined;
                entryGreeks = o ? { delta: o.delta, vega: o.vega, theta: o.theta } : undefined;
              }
              return { ...l, id: `pos-${l.id}`, openedAt: new Date().toISOString(), fees: 0, entryGreeks, ...journal };
            }),
          ],
        })),
      closePosition: (id, closePrice, motivoSaida) => {
        // WO-48: perna do banco ('db-<id>') fecha por boleta, e o livro ressincroniza.
        const m = /^db-(\d+)$/.exec(id);
        if (m) {
          const st = get();
          const p = st.positions.find((x) => x.id === id);
          if (!p) return;
          void fetch("/api/boletas", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tipo: "fechamento", origem: "manual", executadoEm: new Date().toISOString(), ticker: p.underlying, kind: p.kind, posicaoId: Number(m[1]), quantidade: Math.abs(p.qty), preco: closePrice, motivoSaida: motivoSaida ?? null }),
          }).then(() => get().sincronizarLivro()).catch(() => get().sincronizarLivro());
          return;
        }
        set((st) => {
          const pos = st.positions.find((p) => p.id === id);
          if (!pos) return st;
          return {
            positions: st.positions.filter((p) => p.id !== id),
            closed: [...st.closed, { ...pos, closedAt: new Date().toISOString(), closePrice, motivoSaida }],
          };
        });
      },
      closeStructure: (fechamentos, motivoSaida) => {
        // WO-48: se as pernas são do banco, N boletas de fechamento numa chamada só.
        const st = get();
        const doBanco = fechamentos.filter((f) => /^db-\d+$/.test(f.id));
        if (doBanco.length > 0) {
          const agora = new Date().toISOString();
          const boletas = doBanco.map((f) => {
            const p = st.positions.find((x) => x.id === f.id)!;
            return { tipo: "fechamento", origem: "manual", executadoEm: agora, ticker: p.underlying, kind: p.kind, posicaoId: Number(f.id.slice(3)), quantidade: Math.abs(p.qty), preco: f.closePrice, motivoSaida: motivoSaida ?? null };
          });
          void fetch("/api/boletas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boletas }) })
            .then(() => get().sincronizarLivro()).catch(() => get().sincronizarLivro());
          return;
        }
        set((st) => {
          const agora = new Date().toISOString();
          const porId = new Map(fechamentos.map((f) => [f.id, f.closePrice]));
          const fechadas = st.positions
            .filter((p) => porId.has(p.id))
            .map((p) => ({ ...p, closedAt: agora, closePrice: porId.get(p.id)!, motivoSaida }));
          if (fechadas.length === 0) return st;
          return {
            positions: st.positions.filter((p) => !porId.has(p.id)),
            closed: [...st.closed, ...fechadas],
          };
        });
      },
      removePosition: (id) =>
        set((st) => ({ positions: st.positions.filter((p) => p.id !== id) })),
    }),
    {
      name: "opcoes-terminal",
      version: 1,
      migrate: (persisted, version) => {
        const st = persisted as Partial<MarketState>;
        if (version < 1 && st.capitalTotal == null) st.capitalTotal = 100_000;
        return st as MarketState;
      },
      partialize: (st) => ({
        ticker: st.ticker,
        selic: st.selic,
        positions: st.positions,
        closed: st.closed,
        legs: st.legs,
        capitalTotal: st.capitalTotal,
        useOfficialSpot: st.useOfficialSpot,
      }),
    }
  )
);

/** Marcação de uma perna contra um chain específico (null se não achou). */
function markFromChain(pos: Leg, chain: ChainData): number | null {
  if (pos.underlying !== chain.ticker) return null;
  if (pos.kind === "STOCK") return chain.spot;
  const o = chain.options.find((x) => x.opTicker === pos.opTicker);
  return o?.last ?? null;
}

/** Cotação atual de uma posição a partir do chain carregado. */
export function currentPrice(pos: Leg, chain: ChainData | null): number | null {
  if (!chain) return null;
  return markFromChain(pos, chain);
}

export interface MarkInfo {
  price: number | null;
  stale: boolean;
  ageMin: number | null;
  /**
   * WO-30 §2.5: idade da marca em PREGÕES, medida pela data do último negócio da série —
   * não pelo relógio do fetch. Antes, uma posição marcada com prêmio de 16/07 aparecia
   * como "0 min" logo após atualizar a página.
   */
  agePregoes: number | null;
  /** Data do negócio que originou a marca (YYYY-MM-DD). */
  markDate: string | null;
}

export function markInfo(pos: Position, chainCache: Record<string, ChainData>): MarkInfo {
  const chain = chainCache[pos.underlying];
  const refSession = sessionInfo().ultimaSessao;

  if (chain) {
    const live = markFromChain(pos, chain);
    if (live != null) {
      // Idade real = a do último negócio da própria série que originou a marca.
      const q = chain.options.find((o) => o.opTicker === pos.opTicker);
      const markDate = q?.lastTradeAt ? q.lastTradeAt.slice(0, 10) : null;
      const agePregoes = markDate ? sessionsBetween(markDate, refSession) : null;
      return {
        price: live,
        stale: (agePregoes ?? 0) > 1,
        ageMin: null,
        agePregoes,
        markDate,
      };
    }
  }
  if (pos.lastMark != null) {
    const d = pos.lastMarkAt ? pos.lastMarkAt.slice(0, 10) : null;
    return {
      price: pos.lastMark,
      stale: true,
      ageMin: null,
      agePregoes: d ? sessionsBetween(d, refSession) : null,
      markDate: d,
    };
  }
  return { price: null, stale: true, ageMin: null, agePregoes: null, markDate: null };
}
