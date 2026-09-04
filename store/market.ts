"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { effectiveDividends, useDividends } from "@/lib/dividends";
import { enrich, type ApiBody } from "@/lib/enrich-chain";
import { markFromChain } from "@/lib/marcacao";
import { snapshotFromChain, useSnapshots } from "@/lib/snapshots";
import { sessionInfo, sessionsBetween } from "@/lib/session";
import type { ChainData, Leg, OptionQuote, Position } from "@/lib/types";

// WO-57: ApiRow/ApiBody/enrich moveram para lib/enrich-chain.ts, para o servidor (/api/alertas)
// enriquecer a cadeia com as MESMAS regras da tela. Reexportado para quem importava daqui.
export { MAX_SESSOES_OK } from "@/lib/enrich-chain";

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
    /** Tabela de custos vigente — para estimar o custo de fechar (zeragem). */
    custos: import("@/lib/boletas").ConfigCustos | null;
  };
  sincronizarLivro: () => Promise<void>;

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
      livro: { configurado: false, consultadoEm: null, totalBoletas: 0, aviso: null, caixa: null, estruturas: [], boletas: [], custos: null },

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
            set((st) => ({ livro: { ...st.livro, configurado: true, consultadoEm: new Date().toISOString(), totalBoletas: 0, aviso: null, caixa: j.caixa, estruturas: [], boletas: [], custos: j.custos ?? null } }));
            return;
          }
          set({
            positions: j.posicoes,
            closed: j.fechadas,
            // Capital total = o que voce colocou (aportes - retiradas). O caixa depois das compras
            // fica em livro.caixa.saldo — sao numeros diferentes e a tela mostra os dois.
            capitalTotal: Math.max(0, Number(j.caixa?.aportes ?? 0) - Number(j.caixa?.retiradas ?? 0)),
            livro: { configurado: true, consultadoEm: new Date().toISOString(), totalBoletas: j.totalBoletas, aviso: null, caixa: j.caixa, estruturas: j.estruturas, boletas: j.boletas, custos: j.custos ?? null },
          });
        } catch (e: any) {
          set((st) => ({ livro: { ...st.livro, consultadoEm: new Date().toISOString(), aviso: `Não foi possível ler o livro: ${e?.message ?? "erro"}` } }));
        }
      },

      // WO-58: o store NÃO boleta. A Estratégia cria um rascunho (/api/rascunhos) e a boleta nasce na Boletagem.

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
          // WO-56: bid/ask/mid de fechamento do COTAHIST da data efetiva, quando a B3 já publicou.
          // Sem rede ou sem arquivo, a cadeia segue só com o último negócio — como sempre foi.
          try {
            const dataOf = chain.dataEfetiva ?? sess.ultimaSessao;
            const oRes = await fetch(`/api/cotahist?data=${encodeURIComponent(dataOf)}&ticker=${encodeURIComponent(target)}`, { signal: AbortSignal.timeout(20_000) });
            if (oRes.ok) {
              const oj = await oRes.json();
              if (oj?.ok && oj.series) {
                for (const o of chain.options) {
                  // A fonte da cadeia sufixa o ano (PETRI482_2026); o COTAHIST não (PETRI482).
                  const c = oj.series[o.opTicker.replace(/_\d{4}$/, "")] ?? oj.series[o.opTicker];
                  if (!c) continue;
                  o.bid = c.bid ?? null;
                  o.ask = c.ask ?? null;
                  o.mid = c.mid ?? null;
                  o.ofertasData = oj.dataArquivo ?? null;
                }
              }
            }
          } catch {
            /* ofertas são complemento, não requisito */
          }
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

          // WO-50: o snapshot do dia vai para o navegador (cache) E para o banco (origem
          // navegador). Dias sem `dados:sync` deixam de ser buracos; onde o sync já gravou, ele vence.
          const snap = snapshotFromChain(chain);
          useSnapshots.getState().upsert(snap);
          if (typeof window !== "undefined" && snap.atmIvMean != null) {
            fetch("/api/iv-historico", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...snap, data: snap.date, dataEfetiva: chain.dataEfetiva ?? null }),
              signal: AbortSignal.timeout(10_000),
            }).catch(() => {});
          }
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
        // WO-58: perna do banco ('db-<id>') NÃO fecha por aqui — o Portfolio manda um rascunho para a
        // Boletagem, e a boleta nasce lá com o preço da execução. Este caminho é só do cache do navegador.
        if (/^db-\d+$/.test(id)) {
          console.warn("[store] closePosition ignorado para perna do livro — use o rascunho da Boletagem");
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
        // WO-58: pernas do banco NÃO fecham por aqui — rascunho na Boletagem. Só o cache do navegador.
        if (fechamentos.some((f) => /^db-\d+$/.test(f.id))) {
          console.warn("[store] closeStructure ignorado para pernas do livro — use o rascunho da Boletagem");
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
// WO-57: marcação vive em lib/marcacao.ts (a rota /api/alertas precisa dela no servidor). Reexportada.
export { marcaDaSerie, currentPrice, markInfo, type MarkInfo } from "@/lib/marcacao";
