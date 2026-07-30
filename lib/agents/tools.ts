import fs from "fs";
import type { Position } from "../types";
import { strategyMetrics, structureGreeks } from "../payoff";
import { detectStrategy } from "../strategy-detect";
import { alocacaoPorBalde, classificarRisco } from "./risk";
import { getPerformancePath } from "./curator";
import type { GestorGlobalInputContext } from "./senior/gestor-global";
import type { AgentReport } from "./types";

// Engine imports — ferramentas chamam funções REAIS, não resumos de report
import { skewInfo, atmIvNearest } from "../scanner";
import { buildGexProfile, type GexProfile } from "../gex";
import { rollingHV, parkinsonVol, returnStats, volCone } from "../historical";

/**
 * Retorna as 7 ferramentas exigidas pela Fase A do Gestor Global.
 * Todas seguem o formato de BetaRunnableTool do Anthropic SDK.
 * WO-26 B.1: cada ferramenta chama funções reais do engine.
 */
export function getAgentTools(ctx: GestorGlobalInputContext) {
  return [
    {
      name: "get_portfolio",
      description: "Retorna a carteira atual do trader, com alocação por baldes de risco e KPIs.",
      input_schema: {
        type: "object",
        properties: {},
      },
      parse: (input: unknown) => input,
      run: async () => {
        const baldes = alocacaoPorBalde(ctx.positions, ctx.capitalTotal);
        return {
          capitalTotal: ctx.capitalTotal,
          nPosicoes: ctx.positions.length,
          baldes,
          positions: ctx.positions.map((p) => ({
            id: p.id,
            underlying: p.underlying,
            side: p.side,
            qty: p.qty,
            entryPrice: p.price,
            lastMark: p.lastMark,
            risco: classificarRisco([p], null),
            strategyName: detectStrategy([p])?.name ?? "Perna individual",
          })),
        };
      },
    },
    {
      name: "price_structure",
      description: "Avalia risco, payoff, P&L máximo e gregas de uma estrutura hipotética de opções.",
      input_schema: {
        type: "object",
        properties: {
          legs: {
            type: "array",
            description: "Pernas da estrutura",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["OPTION", "STOCK"] },
                type: { type: "string", enum: ["CALL", "PUT"] },
                strike: { type: "number" },
                du: { type: "number" },
                side: { type: "number" },
                qty: { type: "number" },
                price: { type: "number" },
                iv: { type: "number" },
              },
              required: ["kind", "side", "qty", "price"],
            },
          },
          spot: { type: "number", description: "Preço do ativo objeto" },
          r: { type: "number", description: "Taxa livre de risco (obrigatório, ex: 0.1425)" },
        },
        required: ["legs", "spot", "r"],
      },
      parse: (input: unknown) => input,
      run: async (args: any) => {
        if (typeof args.r !== "number") {
          throw new Error("O parâmetro 'r' (taxa livre de risco) é obrigatório.");
        }
        const metrics = strategyMetrics(args.legs, args.spot, args.r);
        const greeks = structureGreeks(args.legs, args.spot, args.r);
        const detected = detectStrategy(args.legs);
        const risco = classificarRisco(args.legs, metrics);

        return {
          strategyName: detected?.name ?? "Estrutura customizada",
          bias: detected?.bias ?? "NEUTRO",
          risco,
          netDebit: metrics.netDebit,
          maxProfit: metrics.maxProfit,
          maxLoss: metrics.maxLoss,
          breakevens: metrics.breakevens,
          popPct: metrics.pop != null ? Number((metrics.pop * 100).toFixed(1)) : null,
          greeks,
        };
      },
    },
    {
      name: "get_chain_summary",
      description: "Calcula skew P/C, IV ATM e regime para um ticker/vencimento específicos, usando o engine real (skewInfo, atmIvNearest). Aceita parâmetros de aprofundamento.",
      input_schema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker do ativo (ex: PETR4)" },
          expiry: { type: "string", description: "Vencimento (ex: 2026-08-21)" },
        },
        required: ["ticker"],
      },
      parse: (input: unknown) => input,
      run: async (args: any) => {
        // Busca chain no contexto (passado via carteiraCtx ou chainCtx)
        const chainCtx = (ctx as any).chainCtx;
        if (!chainCtx?.chain) {
          // Fallback: tenta usar report do chain se disponível
          const rep = ctx.reports.find((r: AgentReport) => r.agentId === "chain");
          if (rep) {
            return { status: "from_report", metricas: rep.metricas, achados: rep.achados };
          }
          return { status: "sem_dado", motivo: "Chain de opções não carregado neste ciclo. Navegue até a aba Chain (tecla 8) e carregue os dados." };
        }
        const chain = chainCtx.chain;
        const expiry = args.expiry ?? chain.options?.[0]?.expiry;
        if (!expiry) {
          return { status: "sem_dado", motivo: "Nenhum vencimento disponível na chain carregada." };
        }
        const skew = skewInfo(chain, expiry);
        const ivAtm = atmIvNearest(chain, expiry);
        return {
          status: "success",
          ticker: args.ticker,
          expiry,
          ivAtmPct: ivAtm != null ? Number((ivAtm * 100).toFixed(2)) : null,
          skewRatio: skew.ratio != null ? Number(skew.ratio.toFixed(3)) : null,
          skewSignal: skew.signal,
          ivCallAtm: skew.ivCallAtm != null ? Number((skew.ivCallAtm * 100).toFixed(2)) : null,
          ivPutAtm: skew.ivPutAtm != null ? Number((skew.ivPutAtm * 100).toFixed(2)) : null,
        };
      },
    },
    {
      name: "get_gex",
      description: "Calcula o perfil de Gamma Exposure (GEX) a partir dos dados de Open Interest da B3 e do chain ativo, usando buildGexProfile do engine.",
      input_schema: {
        type: "object",
        properties: {
          expiryFilter: { type: "string", description: "Filtrar por vencimento específico (opcional)" },
        },
      },
      parse: (input: unknown) => input,
      run: async (args: any) => {
        const chainCtx = (ctx as any).chainCtx;
        if (!chainCtx?.chain || !chainCtx?.oiSeries) {
          // Fallback: report
          const rep = ctx.reports.find((r: AgentReport) => r.agentId === "cockpit");
          if (rep) {
            const gexAchado = rep.achados.find((a: any) => a.id === "cockpit-01" || a.titulo.includes("GEX"));
            if (gexAchado) return { status: "from_report", achado: gexAchado, metricas: rep.metricas };
          }
          return { status: "sem_dado", motivo: "Dados de Open Interest (B3) não disponíveis neste ciclo. Carregue a chain e tente novamente." };
        }
        const profile: GexProfile = buildGexProfile(
          chainCtx.chain,
          chainCtx.oiSeries,
          chainCtx.oiFileDate ?? new Date().toISOString().slice(0, 10),
          args.expiryFilter
        );
        return {
          status: "success",
          regime: profile.regime,
          gammaFlip: profile.gammaFlip,
          callWall: profile.callWall,
          putWall: profile.putWall,
          totalGex: profile.totalGex,
          coverage: profile.coverage,
          topStrikes: profile.byStrike
            .sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex))
            .slice(0, 5)
            .map((s) => ({ strike: s.strike, netGex: s.netGex, callOi: s.callOi, putOi: s.putOi })),
        };
      },
    },
    {
      name: "get_history_stats",
      description: "Calcula volatilidade realizada (HV), estimador de Parkinson, estatísticas de retorno e cone de vol a partir dos candles históricos do ticker ativo.",
      input_schema: {
        type: "object",
        properties: {
          window: { type: "number", description: "Janela de HV em dias (default: 21)" },
        },
      },
      parse: (input: unknown) => input,
      run: async (args: any) => {
        const histCtx = (ctx as any).historyCtx;
        if (!histCtx?.candles || histCtx.candles.length < 20) {
          // Fallback: report
          const rep = ctx.reports.find((r: AgentReport) => r.agentId === "historico");
          if (rep) {
            return { status: "from_report", achados: rep.achados, metricas: rep.metricas };
          }
          return { status: "sem_dado", motivo: "Série histórica insuficiente (< 20 candles). Carregue o histórico na aba Histórico (tecla 9)." };
        }
        const candles = histCtx.candles;
        const w = args.window ?? 21;
        const hvSeries = rollingHV(candles, w);
        const lastHv = hvSeries.filter((v: number | null): v is number => v != null);
        const currentHv = lastHv.length > 0 ? lastHv[lastHv.length - 1] : null;
        const pkVol = parkinsonVol(candles);
        const stats = returnStats(candles);
        const cone = volCone(candles);

        return {
          status: "success",
          currentHvPct: currentHv != null ? Number((currentHv * 100).toFixed(2)) : null,
          parkinsonPct: pkVol != null ? Number((pkVol * 100).toFixed(2)) : null,
          hvWindow: w,
          returnStats: stats ? {
            annVol: Number((stats.annVol * 100).toFixed(2)),
            skew: Number(stats.skew.toFixed(3)),
            kurtosis: Number(stats.kurtosis.toFixed(3)),
            maxDrawdown: Number((stats.maxDrawdown * 100).toFixed(2)),
            periodReturn: Number((stats.periodReturn * 100).toFixed(2)),
          } : null,
          cone: cone.map((r) => ({
            window: r.window,
            min: Number((r.min * 100).toFixed(1)),
            p25: Number((r.p25 * 100).toFixed(1)),
            median: Number((r.median * 100).toFixed(1)),
            p75: Number((r.p75 * 100).toFixed(1)),
            max: Number((r.max * 100).toFixed(1)),
            current: Number((r.current * 100).toFixed(1)),
          })),
        };
      },
    },
    {
      name: "get_agent_report",
      description: "Recupera o report detalhado e cru de um agente específico do DAG.",
      input_schema: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "ID do agente (ex: macro, scanner, estrategia)" },
        },
        required: ["agentId"],
      },
      parse: (input: unknown) => input,
      run: async (args: any) => {
        const rep = ctx.reports.find((r: AgentReport) => r.agentId === args.agentId);
        if (rep) return rep;
        return { status: "sem_dado", motivo: `Report do agente '${args.agentId}' não encontrado no ciclo atual.` };
      },
    },
    {
      name: "get_performance_series",
      description: "Retorna a série temporal de performance do portfólio gravada no Curador de Memória.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Número máximo de dias no histórico" },
        },
      },
      parse: (input: unknown) => input,
      run: async (args: any) => {
        const p = getPerformancePath();
        if (!fs.existsSync(p)) return { status: "sem_dado", motivo: "Série de performance ainda não iniciada. Execute ao menos um ciclo com posições abertas." };
        const lines = fs.readFileSync(p, "utf-8").split("\n").filter(Boolean);
        const limit = args.limit || 30;
        const out = lines.slice(-limit).map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        }).filter(Boolean);
        return { status: "success", performanceSeries: out, totalDias: lines.length };
      },
    },
  ];
}
