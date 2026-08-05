"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Globe,
  LineChart as LineChartIcon,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BrasilMacro, MacroBody, MacroSeries } from "@/app/api/macro/route";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtDateBR, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import { construirProvenance } from "@/lib/provenance";
import { curveSlope, sessionStatus } from "@/lib/macro";
import { Sparkline } from "@/components/Sparkline";
import { AgentPanel } from "@/components/AgentPanel";
import { LinhaRates, type ColunaTabela } from "@/components/macro/LinhaRates";
import { calcularCupomCambial, type VerticeCurva } from "@/lib/curvas";
import type { CurvasBrBody } from "@/app/api/curvas-br/route";

type WindowKey = "1d" | "5d" | "1m" | "3m" | "6m" | "12m" | "YTD";

const WINDOW_LABELS: { key: WindowKey; label: string; field: keyof MacroSeries }[] = [
  { key: "1d", label: "1D", field: "chg1d" },
  { key: "5d", label: "5D", field: "chg5d" },
  { key: "1m", label: "1M (21d)", field: "chg1m" },
  { key: "3m", label: "3M (63d)", field: "chg3m" },
  { key: "6m", label: "6M (126d)", field: "chg6m" },
  { key: "12m", label: "12M (252d)", field: "chg12m" },
  { key: "YTD", label: "YTD", field: "ytd" },
];

export interface ImpactDriverConfig {
  driverName: string;
  symbol: string;
  tickers: string[];
  explicacao: string;
}

const IMPACT_DRIVERS: ImpactDriverConfig[] = [
  {
    driverName: "Petróleo Brent / WTI",
    symbol: "BZ=F",
    tickers: ["PETR4", "PRIO3", "RECV3", "CSAN3"],
    explicacao: "Impacta margens de exploração e refino (PETR4/PRIO3/RECV3) e bioenergia (CSAN3).",
  },
  {
    driverName: "Cobre & Xangai (Minério / China)",
    symbol: "HG=F",
    tickers: ["VALE3", "CSNA3", "CMIN3", "GGBR4", "USIM5"],
    explicacao: "Proxy de demanda de metais e siderurgia para a China.",
  },
  {
    driverName: "USD / BRL & DXY",
    symbol: "USDBRL=X",
    tickers: ["PETR4", "VALE3", "GGBR4", "MGLU3", "BHIA3", "CVCB3"],
    explicacao: "Favorece receita de exportadoras (PETR4/VALE3/GGBR4) e encarece custos/insumos do varejo.",
  },
  {
    driverName: "Juros US (10Y) & Selic Meta",
    symbol: "^TNX",
    tickers: ["BPAC11", "BBSE3", "MGLU3", "BHIA3", "CVCB3", "COGN3"],
    explicacao: "Impacta tesouraria de bancos/seguradoras e precificação de empresas de alta duração (duration/consumo).",
  },
  {
    driverName: "VIX (Volatilidade Global)",
    symbol: "^VIX",
    tickers: ["PETR4", "VALE3", "BOVA11", "MGLU3"],
    explicacao: "Regime de aversão ao risco global — afeta a superfície inteira de volatilidade de opções.",
  },
  {
    driverName: "Ibovespa & S&P Futuros",
    symbol: "^BVSP",
    tickers: ["BOVA11", "PETR4", "VALE3", "BPAC11"],
    explicacao: "Direção de fluxo institucional e beta geral do book de posições.",
  },
];

export default function MacroPage() {
  const router = useRouter();
  const { selic, setTicker } = useMarket();

  const [data, setData] = useState<MacroBody | null>(null);
  // WO-32: curvas brasileiras (pré e NTN-B) do Tesouro Transparente.
  const [curvas, setCurvas] = useState<CurvasBrBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<WindowKey>("1d");

  // Painéis colapsáveis
  const [sessoesOpen, setSessoesOpen] = useState(true);
  const [mercadosOpen, setMercadosOpen] = useState(true);
  const [ratesOpen, setRatesOpen] = useState(true);
  const [impactoOpen, setImpactoOpen] = useState(true);

  useEffect(() => {
    try {
      const s = localStorage.getItem("macro-sessoes-open");
      const m = localStorage.getItem("macro-mercados-open");
      const r = localStorage.getItem("macro-rates-open");
      const i = localStorage.getItem("macro-impacto-open");
      if (s !== null) setSessoesOpen(s === "true");
      if (m !== null) setMercadosOpen(m === "true");
      if (r !== null) setRatesOpen(r === "true");
      if (i !== null) setImpactoOpen(i === "true");
    } catch {}
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/macro");
      if (res.ok) {
        setData(await res.json());
      } else {
        setError("Falha ao carregar dados macro globais.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
    const id = setInterval(() => void loadData(), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadData]);

  // O CSV do Tesouro é atualizado uma vez por dia útil; a rota já cacheia por 6h.
  useEffect(() => {
    let vivo = true;
    fetch("/api/curvas-br")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j) setCurvas(j); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  // Curva US em anos, para interpolar no prazo de cada vértice brasileiro.
  const curvaUsEmAnos: VerticeCurva[] = useMemo(() => {
    if (!data) return [];
    const mapa: [string, number][] = [["^IRX", 0.25], ["^FVX", 5], ["^TNX", 10], ["^TYX", 30]];
    return mapa
      .map(([sym, anos]) => {
        const s = data.series.find((x) => x.symbol === sym);
        return s?.last != null ? { vencimento: `US-${anos}Y`, anos, taxa: s.last } : null;
      })
      .filter((x): x is VerticeCurva => x != null);
  }, [data]);

  const cupomCambial = useMemo(
    () => calcularCupomCambial(curvas?.pre ?? [], curvaUsEmAnos),
    [curvas, curvaUsEmAnos]
  );

  // BRL/USD: preço no gráfico, variação por janela na tabela.
  const usdBrlSerie = useMemo(() => {
    const s = data?.series.find((x) => x.symbol === "USDBRL=X");
    if (!s) return null;
    const serie = (s.sparkline ?? []).map((v, i) => ({ rotulo: String(i + 1), valor: v }));
    const janelas = [
      { rotulo: "1D", anos: 0, valor: s.chg1d != null ? s.chg1d * 100 : null },
      { rotulo: "5D", anos: 0, valor: s.chg5d != null ? s.chg5d * 100 : null },
      { rotulo: "1M", anos: 0, valor: s.chg1m != null ? s.chg1m * 100 : null },
      { rotulo: "3M", anos: 0, valor: s.chg3m != null ? s.chg3m * 100 : null },
      { rotulo: "6M", anos: 0, valor: s.chg6m != null ? s.chg6m * 100 : null },
      { rotulo: "12M", anos: 0, valor: s.chg12m != null ? s.chg12m * 100 : null },
    ];
    return { serie, janelas, dataDoDado: s.dataDoDado ?? null };
  }, [data]);

  // Status das sessões
  const sessoesStatus = useMemo(() => {
    const now = new Date();
    return {
      asia: sessionStatus("ASIA", now),
      europe: sessionStatus("EUROPE", now),
      eua: sessionStatus("EUA", now),
      brasil: sessionStatus("BRASIL", now),
    };
  }, []);

  // Dados da curva de juros US
  const usYieldCurve = useMemo(() => {
    if (!data) return null;
    const findSeries = (sym: string) => data.series.find((s) => s.symbol === sym);
    const y3m = findSeries("^IRX");
    const y5y = findSeries("^FVX");
    const y10y = findSeries("^TNX");
    const y30y = findSeries("^TYX");

    const slopeInfo = curveSlope(y10y?.last ?? null, y3m?.last ?? null);

    // Recharts 3 séries: Hoje vs 1M atrás vs 3M atrás
    const chartData = [
      {
        tenor: "3M",
        hoje: y3m?.last,
        h1m: y3m && y3m.chg1m != null ? y3m.last! - y3m.chg1m / 100 : null,
        h3m: y3m && y3m.chg3m != null ? y3m.last! - y3m.chg3m / 100 : null,
      },
      {
        tenor: "5Y",
        hoje: y5y?.last,
        h1m: y5y && y5y.chg1m != null ? y5y.last! - y5y.chg1m / 100 : null,
        h3m: y5y && y5y.chg3m != null ? y5y.last! - y5y.chg3m / 100 : null,
      },
      {
        tenor: "10Y",
        hoje: y10y?.last,
        h1m: y10y && y10y.chg1m != null ? y10y.last! - y10y.chg1m / 100 : null,
        h3m: y10y && y10y.chg3m != null ? y10y.last! - y10y.chg3m / 100 : null,
      },
      {
        tenor: "30Y",
        hoje: y30y?.last,
        h1m: y30y && y30y.chg1m != null ? y30y.last! - y30y.chg1m / 100 : null,
        h3m: y30y && y30y.chg3m != null ? y30y.last! - y30y.chg3m / 100 : null,
      },
    ];

    return { y3m, y5y, y10y, y30y, slopeInfo, chartData };
  }, [data]);

  // Reordenação de séries por janela selecionada
  const activeField = useMemo(() => {
    return WINDOW_LABELS.find((w) => selectedWindow.startsWith(w.key))?.field ?? "chg1d";
  }, [selectedWindow]);

  const getSortedSeries = useCallback(
    (grupo: MacroSeries["grupo"]) => {
      if (!data) return [];
      const list = data.series.filter((s) => s.grupo === grupo);
      return list.sort((a, b) => {
        const valA = (a[activeField] as number) ?? -999;
        const valB = (b[activeField] as number) ?? -999;
        return valB - valA;
      });
    },
    [data, activeField]
  );

  // ===================== WO-33: as seis linhas do Rates & FX =====================
  // Cada linha traz o nível à esquerda e as variações à direita, na ordem pedida:
  // Pré · Treasuries · Cupom cambial · BRL/USD · NTN-B · IPCA & IGP-M.
  const linhasRates = useMemo(() => {
    const HIST = [
      { chave: "d1", nome: "1D atrás", cor: "#94a3b8", op: 0.9 },
      { chave: "d5", nome: "5D atrás", cor: "#64748b", op: 0.8 },
      { chave: "d21", nome: "1M atrás", cor: "#fbbf24", op: 0.8 },
      { chave: "d63", nome: "3M atrás", cor: "#6b7689", op: 0.7 },
    ] as const;

    const colunasCurva: ColunaTabela[] = [
      { chave: "vertice", rotulo: "VÉRTICE", tipo: "texto" },
      { chave: "taxa", rotulo: "TAXA", tipo: "taxa" },
      { chave: "d1", rotulo: "Δ 1D", tipo: "bps" },
      { chave: "d5", rotulo: "Δ 5D", tipo: "bps" },
      { chave: "d21", rotulo: "Δ 1M", tipo: "bps" },
      { chave: "d63", rotulo: "Δ 3M", tipo: "bps" },
    ];

    const rot = (v: string) => v.slice(0, 7);

    /** Monta os dois gráficos de uma curva do Tesouro a partir do payload da rota. */
    const daCurvaTesouro = (vertices: any[], hist: any, titulo: string, cor: string, nota: string) => {
      const variacaoDados = vertices.map((v) => {
        const linha: any = { x: rot(v.vencimento), hoje: v.taxa };
        for (const h of HIST) {
          const anterior = (hist?.[h.chave] ?? []).find((a: any) => a.vencimento === v.vencimento);
          linha[h.chave] = anterior ? anterior.taxa : null;
        }
        return linha;
      });
      return {
        titulo,
        nota,
        nivel: {
          dados: vertices.map((v) => ({ x: rot(v.vencimento), hoje: v.taxa })),
          xKey: "x",
          series: [{ chave: "hoje", nome: "Hoje", cor }],
        },
        variacao: {
          dados: variacaoDados,
          xKey: "x",
          series: [
            { chave: "hoje", nome: "Hoje", cor },
            ...HIST.map((h) => ({ chave: h.chave, nome: h.nome, cor: h.cor, tracejada: true, opacidade: h.op })),
          ],
        },
        tabela: {
          colunas: colunasCurva,
          linhas: vertices.map((v) => ({
            vertice: rot(v.vencimento), taxa: v.taxa, d1: v.d1, d5: v.d5, d21: v.d21, d63: v.d63,
          })),
        },
      };
    };

    const out: any[] = [];

    // 1 — Pré (Tesouro)
    out.push({
      ...daCurvaTesouro(
        curvas?.pre ?? [], curvas?.historico?.pre, "Pré (Tesouro) — curva nominal BR", "#fbbf24",
        "Curva dos títulos prefixados do Tesouro (LTN/NTN-F). Não é a curva de futuros DI1 da B3."
      ),
      fonte: "Tesouro Transparente",
      dataDoDado: curvas?.dataBase ?? null,
      vazio: "Curva do Tesouro indisponível nesta execução.",
    });

    // 2 — Treasuries US: as curvas passadas são reconstruídas de `hoje − variação`, que é o
    // método que este painel já usava para desenhar "1M atrás".
    const tenores: [string, string][] = [["^IRX", "3M"], ["^FVX", "5Y"], ["^TNX", "10Y"], ["^TYX", "30Y"]];
    const us = tenores.map(([sym, rotulo]) => {
      const s = data?.series.find((x) => x.symbol === sym);
      const hoje = s?.last ?? null;
      const volta = (chg: number | null | undefined) => (hoje != null && chg != null ? hoje - chg / 100 : null);
      // O grupo JURO já entrega as variações em bps; a tabela padronizada trabalha em pp.
      const pp = (chg: number | null | undefined) => (chg != null ? chg / 100 : null);
      return {
        x: rotulo, hoje,
        d1: volta(s?.chg1d), d5: volta(s?.chg5d), d21: volta(s?.chg1m), d63: volta(s?.chg3m),
        vd1: pp(s?.chg1d), vd5: pp(s?.chg5d), vd21: pp(s?.chg1m), vd63: pp(s?.chg3m),
      };
    });
    out.push({
      titulo: "Treasuries US — curva nominal",
      fonte: "Yahoo Finance",
      dataDoDado: data?.series.find((x) => x.symbol === "^TNX")?.dataDoDado ?? null,
      nota: usYieldCurve?.slopeInfo.slope != null
        ? `Curva ${usYieldCurve.slopeInfo.label} (10Y−3M: ${usYieldCurve.slopeInfo.slope.toFixed(2)}%).`
        : undefined,
      nivel: {
        dados: us.map((u) => ({ x: u.x, hoje: u.hoje })),
        xKey: "x",
        series: [{ chave: "hoje", nome: "Hoje", cor: "#22d3ee" }],
      },
      variacao: {
        dados: us, xKey: "x",
        series: [
          { chave: "hoje", nome: "Hoje", cor: "#22d3ee" },
          ...HIST.map((h) => ({ chave: h.chave, nome: h.nome, cor: h.cor, tracejada: true, opacidade: h.op })),
        ],
      },
      tabela: {
        colunas: colunasCurva,
        linhas: us.map((u) => ({ vertice: u.x, taxa: u.hoje, d1: u.vd1, d5: u.vd5, d21: u.vd21, d63: u.vd63 })),
      },
      vazio: "Séries de Treasuries indisponíveis.",
    });

    // 3 — Cupom cambial: derivado nas duas pontas, por isso EST.
    out.push({
      titulo: "Cupom cambial — diferencial BR × US",
      fonte: "derivado (pré × Treasuries)",
      dataDoDado: curvas?.dataBase ?? null,
      estimado: true,
      nota: "Derivado: (1+pré)/(1+US)−1, com a curva US interpolada para o prazo de cada vértice brasileiro. Fora do intervalo dos Treasuries o vértice fica em —.",
      nivel: {
        dados: cupomCambial.map((c) => ({ x: rot(c.vencimento), hoje: c.cupom })),
        xKey: "x",
        series: [{ chave: "hoje", nome: "Cupom", cor: "#a78bfa" }],
      },
      variacao: {
        dados: cupomCambial.map((c) => ({ x: rot(c.vencimento), hoje: c.cupom, taxaBr: c.taxaBr, taxaUs: c.taxaUs })),
        xKey: "x",
        series: [
          { chave: "hoje", nome: "Cupom", cor: "#a78bfa" },
          { chave: "taxaBr", nome: "Pré BR", cor: "#fbbf24", tracejada: true, opacidade: 0.7 },
          { chave: "taxaUs", nome: "US interp.", cor: "#22d3ee", tracejada: true, opacidade: 0.7 },
        ],
      },
      tabela: {
        colunas: [
          { chave: "vertice", rotulo: "VÉRTICE", tipo: "texto" },
          { chave: "taxaBr", rotulo: "PRÉ BR", tipo: "taxa" },
          { chave: "taxaUs", rotulo: "US", tipo: "taxa" },
          { chave: "taxa", rotulo: "CUPOM", tipo: "taxa" },
        ] as ColunaTabela[],
        linhas: cupomCambial.map((c) => ({ vertice: rot(c.vencimento), taxaBr: c.taxaBr, taxaUs: c.taxaUs, taxa: c.cupom })),
      },
      vazio: "Precisa da curva pré e dos Treasuries para calcular.",
    });

    // 4 — BRL/USD: não é curva. Preço à esquerda, variação por janela à direita.
    out.push({
      titulo: "BRL/USD — preço e variações",
      fonte: "Yahoo Finance",
      dataDoDado: usdBrlSerie?.dataDoDado ?? null,
      nota: "Esquerda: preço nos últimos pregões. Direita: variação acumulada por janela.",
      nivel: {
        dados: (usdBrlSerie?.serie ?? []).map((p) => ({ x: p.rotulo, hoje: p.valor })),
        xKey: "x",
        series: [{ chave: "hoje", nome: "USD/BRL", cor: "#f87171" }],
        unidade: "",
      },
      variacao: {
        dados: (usdBrlSerie?.janelas ?? []).map((j) => ({ x: j.rotulo, hoje: j.valor })),
        xKey: "x",
        series: [{ chave: "hoje", nome: "Variação", cor: "#f87171" }],
        unidade: "%",
      },
      tabela: {
        colunas: [
          { chave: "vertice", rotulo: "JANELA", tipo: "texto" },
          { chave: "variacao", rotulo: "VARIAÇÃO", tipo: "pct" },
        ] as ColunaTabela[],
        linhas: (usdBrlSerie?.janelas ?? []).map((j) => ({ vertice: j.rotulo, variacao: j.valor })),
      },
      vazio: "Série USD/BRL indisponível nesta execução.",
    });

    // 5 — NTN-B
    out.push({
      ...daCurvaTesouro(
        curvas?.ntnb ?? [], curvas?.historico?.ntnb, "NTN-B — curva real BR", "#34d399",
        "Taxa real (acima do IPCA) dos títulos Tesouro IPCA+."
      ),
      fonte: "Tesouro Transparente",
      dataDoDado: curvas?.dataBase ?? null,
      vazio: "Curva NTN-B indisponível nesta execução.",
    });

    // 6 — IPCA & IGP-M: série mensal e acumulados COMPOSTOS.
    const acum = (serie: { valor: number }[] | undefined, n: number): number | null => {
      if (!serie || serie.length < n) return null;
      // Π(1+i) − 1. Somar as variações mensais dá outro número e seria errado.
      const janela = serie.slice(-n);
      return Number(((janela.reduce((a, x) => a * (1 + x.valor / 100), 1) - 1) * 100).toFixed(2));
    };
    const ipcaS = data?.brasil.ipcaMensalSeries ?? [];
    const igpmS = data?.brasil.igpmSeries ?? [];
    const serieInflacao = ipcaS.map((x, i) => ({
      x: (x.data ?? "").slice(3),
      ipca: x.valor,
      igpm: igpmS[i]?.valor ?? null,
    }));
    const ultimo = (s: { valor: number }[]) => (s.length ? s[s.length - 1].valor : null);
    const seriesInflacao = [
      { chave: "ipca", nome: "IPCA m/m", cor: "#22d3ee" },
      { chave: "igpm", nome: "IGP-M m/m", cor: "#fbbf24" },
    ];
    out.push({
      titulo: "IPCA & IGP-M — inflação",
      fonte: "BCB SGS",
      dataDoDado: null,
      nota: "Acumulados compostos: Π(1+i)−1, não soma das variações mensais.",
      // Esquerda: a leitura mensal. Direita: o acumulado em 12 meses ao longo do tempo — é a
      // série que mostra tendência, e repetir o mesmo gráfico nos dois lados não informaria nada.
      nivel: { dados: serieInflacao, xKey: "x", series: seriesInflacao },
      variacao: {
        dados: (data?.brasil.ipca12mSeries ?? []).map((x) => ({ x: (x.data ?? "").slice(3), acum12: x.valor })),
        xKey: "x",
        series: [{ chave: "acum12", nome: "IPCA 12m", cor: "#22d3ee" }],
      },
      tabela: {
        colunas: [
          { chave: "vertice", rotulo: "ÍNDICE", tipo: "texto" },
          { chave: "mes", rotulo: "MÊS", tipo: "pct" },
          { chave: "m3", rotulo: "3M", tipo: "pct" },
          { chave: "m6", rotulo: "6M", tipo: "pct" },
          { chave: "m12", rotulo: "12M", tipo: "pct" },
        ] as ColunaTabela[],
        linhas: [
          { vertice: "IPCA", mes: ultimo(ipcaS), m3: acum(ipcaS, 3), m6: acum(ipcaS, 6), m12: data?.brasil.ipca12m ?? acum(ipcaS, 12) },
          { vertice: "IGP-M", mes: ultimo(igpmS), m3: acum(igpmS, 3), m6: acum(igpmS, 6), m12: acum(igpmS, 12) },
          { vertice: "IPCA-15", mes: data?.brasil.ipca15 ?? null, m3: null, m6: null, m12: null },
          { vertice: "INPC", mes: data?.brasil.inpc ?? null, m3: null, m6: null, m12: null },
        ],
      },
      vazio: "Séries de inflação indisponíveis.",
    });

    return out;
  }, [curvas, data, cupomCambial, usdBrlSerie, usYieldCurve]);

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto font-mono">
      <AgentPanel
        agentId="macro"
        title="Agente Especialista Macro & Rates"
        agentContext={{
          ticker: null,
          selic,
          macroSeries: data,
        }}
      />
      {/* Header com Seletor de Janela & Status */}
      <div className="panel p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-term-cyan" />
          <span className="font-bold text-term-cyan text-sm">Macro Global & Rates — A Tela das 9h</span>
          {/* WO-30 §2.1: o carimbo é a data do PREGÃO das séries, não a hora do fetch.
              Séries de praças diferentes podem fechar em datas diferentes — mostramos a
              mais recente e a mais antiga quando divergem. */}
          {(() => {
            if (!data?.series?.length) return null;
            const datas = Array.from(
              new Set(data.series.map((s) => s.dataDoDado).filter((d): d is string => !!d))
            ).sort();
            if (!datas.length) return null;
            const maisNova = datas[datas.length - 1];
            const maisAntiga = datas[0];
            const prov = construirProvenance("Yahoo Finance", maisNova, { buscadoEm: data.updatedAt });
            return (
              <span
                className={`tag ${prov.frescor === "ANTIGO" ? "bg-term-gold/20 text-term-gold" : "bg-term-cyan/15 text-term-cyan"}`}
                title={`Fechamentos de ${fmtDateBR(maisAntiga)} a ${fmtDateBR(maisNova)} — praças distintas fecham em datas distintas. Buscado às ${new Date(
                  data.updatedAt
                ).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`}
              >
                DADOS DE {fmtDateBR(maisNova)}
                {maisAntiga !== maisNova ? ` (mais antiga ${fmtDateBR(maisAntiga)})` : ""}
              </span>
            );
          })()}
        </div>

        <div className="flex items-center gap-3">
          {/* Seletor de Janela Global */}
          <div className="flex items-center gap-1 bg-term-panel border border-term-line rounded p-0.5">
            {WINDOW_LABELS.map((w) => (
              <button
                key={w.key}
                onClick={() => setSelectedWindow(w.key)}
                className={clsx(
                  "px-2 py-1 text-xxs font-mono rounded transition-colors",
                  selectedWindow === w.key
                    ? "bg-term-cyan/20 text-term-cyan font-bold border border-term-cyan/40"
                    : "text-term-dim hover:text-term-text"
                )}
              >
                {w.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="btn text-xxs py-1.5 px-3 flex items-center gap-1"
          >
            <RefreshCw size={12} className={loading ? "animate-spin text-term-cyan" : ""} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Strip de falhas se algum símbolo falhar */}
      {data?.falhas && data.falhas.length > 0 && (
        <div className="bg-term-gold/10 border border-term-gold/40 text-term-gold px-3 py-1.5 rounded text-xs flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            Degradação graciosa: <b>{data.falhas.join(", ")}</b> indisponível(is) momentaneamente. Os demais ativos seguem atualizados.
          </span>
        </div>
      )}

      {/* 1. ESTADO DAS SESSÕES */}
      <div id="sessoes-globais" className="panel">
        <div
          onClick={() => {
            const next = !sessoesOpen;
            setSessoesOpen(next);
            localStorage.setItem("macro-sessoes-open", String(next));
          }}
          className="panel-title flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            {sessoesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Clock size={14} className="text-term-cyan" />
            <span className="font-bold">[1] Estado das Sessões Globais — Horários & Clima</span>
          </div>
        </div>

        {sessoesOpen && (
          <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
            {/* Ásia */}
            <div className="panel p-2.5 border border-term-line/60 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-term-text">Ásia</span>
                <StatusBadge status={sessoesStatus.asia} />
              </div>
              <div className="text-xxs text-term-dim">Nikkei • Hang Seng • Xangai</div>
              <div className="text-xxs text-term-dim pt-1 border-t border-term-line/40">
                Horário BRT: ~21:00 às 04:00
              </div>
            </div>

            {/* Europa */}
            <div className="panel p-2.5 border border-term-line/60 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-term-text">Europa</span>
                <StatusBadge status={sessoesStatus.europe} />
              </div>
              <div className="text-xxs text-term-dim">Euro Stoxx 50 • DAX</div>
              <div className="text-xxs text-term-dim pt-1 border-t border-term-line/40">
                Horário BRT: 05:00 às 13:30
              </div>
            </div>

            {/* EUA */}
            <div className="panel p-2.5 border border-term-line/60 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-term-text">EUA (Futuros/Cash)</span>
                <StatusBadge status={sessoesStatus.eua} />
              </div>
              <div className="text-xxs text-term-dim">S&P 500 • Nasdaq • Dow</div>
              <div className="text-xxs text-term-dim pt-1 border-t border-term-line/40">
                Horário BRT: 10:30 às 17:00 (Pré: 05h)
              </div>
            </div>

            {/* Brasil */}
            <div className="panel p-2.5 border border-term-line/60 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-term-text">Brasil (B3)</span>
                <StatusBadge status={sessoesStatus.brasil} />
              </div>
              <div className="text-xxs text-term-dim">Ibovespa (^BVSP)</div>
              <div className="text-xxs text-term-dim pt-1 border-t border-term-line/40">
                Horário BRT: 10:00 às 17:55
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. PAINÉIS DE MERCADO */}
      <div className="panel">
        <div
          onClick={() => {
            const next = !mercadosOpen;
            setMercadosOpen(next);
            localStorage.setItem("macro-mercados-open", String(next));
          }}
          className="panel-title flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            {mercadosOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Compass size={14} className="text-term-gold" />
            <span className="font-bold">[2] Painéis de Mercado — Índices, Futuros, VIX, Moedas e Commodities</span>
          </div>

          <span className="text-xxs text-term-dim">
            Reordenados por: <b>{selectedWindow}</b>
          </span>
        </div>

        {mercadosOpen && (
          <div className="p-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse table-fixed min-w-[850px]">
                <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
                  <tr className="border-b border-term-line text-xxs text-term-dim uppercase bg-term-panel2/40">
                    <th className="py-2 px-2 w-[26%]">Ativo</th>
                    <th className="py-2 px-1 w-[10%]">Último</th>
                    <th className="py-2 px-1 w-[10%]">Var Ativa</th>
                    <th className="py-2 px-1 w-[7%]">1D</th>
                    <th className="py-2 px-1 w-[7%]">5D</th>
                    <th className="py-2 px-1 w-[7%]">1M</th>
                    <th className="py-2 px-1 w-[7%]">YTD</th>
                    <th className="py-2 px-1 w-[7%]">HV21</th>
                    <th className="py-2 px-1 w-[9%]">Tendência</th>
                    <th className="py-2 px-1 w-[10%]">Sparkline (1A)</th>
                  </tr>
                </thead>
                <tbody>
                  <MarketSectionGroup
                    title="Índices Acionários Globais"
                    list={getSortedSeries("INDICE")}
                    activeField={activeField}
                  />
                  <MarketSectionGroup
                    title="Futuros EUA & Volatilidade (VIX)"
                    list={[...getSortedSeries("FUTURO"), ...getSortedSeries("VOL")]}
                    activeField={activeField}
                  />
                  <MarketSectionGroup
                    title="Moedas & Dólar"
                    list={getSortedSeries("MOEDA")}
                    activeField={activeField}
                  />
                  <MarketSectionGroup
                    title="Commodities"
                    list={getSortedSeries("COMMODITY")}
                    activeField={activeField}
                  />
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 3. IMPACTO NO MEU UNIVERSO — sobe para logo depois dos painéis de mercado (WO-33 §2) */}
      <div id="impacto-universo" className="panel">
        <div
          onClick={() => {
            const next = !impactoOpen;
            setImpactoOpen(next);
            localStorage.setItem("macro-impacto-open", String(next));
          }}
          className="panel-title flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            {impactoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Zap size={14} className="text-term-gold" />
            <span className="font-bold">[3] Impacto no Meu Universo — Driver → Tickers Afetados</span>
          </div>
        </div>

        {impactoOpen && (
          <div className="p-3 space-y-3 font-mono text-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
                  <tr className="border-b border-term-line text-xxs text-term-dim uppercase">
                    <th className="py-1 px-2">Driver Macro</th>
                    <th className="py-1 px-2">Movimento ({selectedWindow})</th>
                    <th className="py-1 px-2">Tickers Afetados no Universo</th>
                    <th className="py-1 px-2">Racional de Transmissão</th>
                  </tr>
                </thead>
                <tbody>
                  {IMPACT_DRIVERS.map((item) => {
                    const ser = data?.series.find((s) => s.symbol === item.symbol);
                    const valChg = ser ? (ser[activeField] as number) : null;
                    const isBps = ser?.grupo === "JURO";

                    return (
                      <tr key={item.driverName} className="border-b border-term-line/30 hover:bg-term-line/10">
                        <td className="py-2 px-2 font-bold text-term-cyan">{item.driverName}</td>
                        <td className="py-2 px-2">
                          {valChg != null ? (
                            <span className={clsx("font-semibold", valChg >= 0 ? "text-term-up" : "text-term-down")}>
                              {valChg >= 0 ? "+" : ""}
                              {isBps ? `${valChg.toFixed(1)} bps` : fmtPct(valChg)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex flex-wrap gap-1">
                            {item.tickers.map((t) => (
                              <button
                                key={t}
                                onClick={() => {
                                  setTicker(t);
                                  router.push("/chain");
                                }}
                                className="tag bg-term-line hover:bg-term-cyan hover:text-term-bg cursor-pointer transition-colors font-bold text-xxs"
                                title={`Carregar chain de ${t}`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-xxs text-term-dim">{item.explicacao}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 4. RATES & FX */}
      <div id="curva-juros" className="panel">
        <div
          onClick={() => {
            const next = !ratesOpen;
            setRatesOpen(next);
            localStorage.setItem("macro-rates-open", String(next));
          }}
          className="panel-title flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            {ratesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <LineChartIcon size={14} className="text-term-up" />
            <span className="font-bold">[4] Rates &amp; FX</span>
          </div>
        </div>

        {/* Cartões de referência de curto prazo: contra eles se lê a ponta curta das curvas */}
        {ratesOpen && (
          <div className="px-3 pt-3 grid grid-cols-3 gap-2">
            <MacroCard title="Selic Meta" val={data?.brasil.selicMeta != null ? `${data.brasil.selicMeta.toFixed(2)}% a.a.` : "—"} />
            <MacroCard title="Selic Efetiva" val={data?.brasil.selicEfetiva != null ? `${data.brasil.selicEfetiva.toFixed(2)}% a.a.` : "—"} />
            <MacroCard title="CDI Diário" val={data?.brasil.cdiDaily != null ? `${data.brasil.cdiDaily.toFixed(4)}% a.d.` : "—"} />
          </div>
        )}

        {ratesOpen && (
          <div className="p-3 space-y-3">
            {/* WO-34 §A: Pré e Treasuries dividem a primeira linha, cada um só com o painel de
                variações — o nível já se lê na coluna TAXA da tabela. As demais seguem em
                largura inteira com os dois painéis. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {linhasRates.slice(0, 2).map((l) => (
                <LinhaRates key={l.titulo} {...l} modo="somenteVariacao" />
              ))}
            </div>
            {linhasRates.slice(2).map((l) => (
              <LinhaRates key={l.titulo} {...l} />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "ABERTO" | "FECHADO" | "PRÉ" | "PÓS" }) {
  if (status === "ABERTO") {
    return <span className="tag bg-term-up/20 text-term-up font-bold animate-pulse">● ABERTO</span>;
  }
  if (status === "PRÉ") {
    return <span className="tag bg-term-gold/20 text-term-gold font-bold">● PRÉ-MARKET</span>;
  }
  if (status === "PÓS") {
    return <span className="tag bg-term-cyan/20 text-term-cyan">● PÓS-MARKET</span>;
  }
  return <span className="tag bg-term-line text-term-dim">FECHADO</span>;
}

function BpsCell({ val }: { val: number | null }) {
  if (val == null) return <span className="text-term-dim">—</span>;
  return (
    <span className={clsx("font-semibold", val >= 0 ? "text-term-up" : "text-term-down")}>
      {val >= 0 ? "+" : ""}
      {val.toFixed(1)}
    </span>
  );
}

function MarketSectionGroup({
  title,
  list,
  activeField,
}: {
  title: string;
  list: MacroSeries[];
  activeField: keyof MacroSeries;
}) {
  if (!list.length) return null;

  return (
    <>
      <tr className="bg-term-panel2/80 border-y border-term-line/60">
        <td colSpan={10} className="py-2 px-2 font-bold text-term-cyan text-xs">
          {title} <span className="text-xxs font-normal text-term-dim">({list.length} ativos)</span>
        </td>
      </tr>
      {list.map((s) => {
        const valActive = (s[activeField] as number) ?? null;
        const isBps = s.grupo === "JURO";

        let bgHeat = "";
        if (valActive != null) {
          const alpha = Math.min(Math.abs(valActive) * (isBps ? 0.05 : 10), 0.25).toFixed(2);
          bgHeat = valActive >= 0 ? `rgba(0, 200, 5, ${alpha})` : `rgba(255, 59, 48, ${alpha})`;
        }

        return (
          <tr key={s.symbol} className="border-b border-term-line/20 hover:bg-term-line/10">
            <td className="py-1.5 px-2 font-bold text-term-text truncate" title={`${s.nome} (${s.symbol})`}>
              {s.nome} <span className="text-xxs text-term-dim">({s.symbol})</span>
            </td>
            <td className="py-1.5 px-1 text-term-cyan font-semibold truncate">
              {s.last != null ? (isBps ? `${s.last.toFixed(2)}%` : fmtNum(s.last, 2)) : "—"}
            </td>
            <td className="py-1.5 px-1 truncate" style={{ backgroundColor: bgHeat }}>
              {valActive != null ? (
                <span className={clsx("font-bold", valActive >= 0 ? "text-term-up" : "text-term-down")}>
                  {valActive >= 0 ? "+" : ""}
                  {isBps ? `${valActive.toFixed(1)} bps` : fmtPct(valActive)}
                </span>
              ) : (
                "—"
              )}
            </td>
            <td className="py-1.5 px-1 truncate"><ValCell val={s.chg1d} isBps={isBps} /></td>
            <td className="py-1.5 px-1 truncate"><ValCell val={s.chg5d} isBps={isBps} /></td>
            <td className="py-1.5 px-1 truncate"><ValCell val={s.chg1m} isBps={isBps} /></td>
            <td className="py-1.5 px-1 truncate"><ValCell val={s.ytd} isBps={isBps} /></td>
            <td className="py-1.5 px-1 truncate">{s.hv21 != null ? fmtPct(s.hv21) : "—"}</td>
            <td className="py-1.5 px-1">
              {s.tendencia === "ALTA" ? (
                <span className="tag bg-term-up/20 text-term-up font-bold">ALTA</span>
              ) : s.tendencia === "BAIXA" ? (
                <span className="tag bg-term-down/20 text-term-down font-bold">BAIXA</span>
              ) : (
                <span className="tag bg-term-line text-term-dim">LATERAL</span>
              )}
            </td>
            <td className="py-1.5 px-1">
              <Sparkline data={s.sparkline} color={valActive != null && valActive >= 0 ? "#00c805" : "#ff3b30"} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function ValCell({ val, isBps }: { val: number | null; isBps?: boolean }) {
  if (val == null) return <span className="text-term-dim">—</span>;
  return (
    <span className={clsx(val >= 0 ? "text-term-up" : "text-term-down")}>
      {val >= 0 ? "+" : ""}
      {isBps ? `${val.toFixed(1)} bps` : fmtPct(val)}
    </span>
  );
}

function MacroCard({ title, val, series }: { title: string; val: string; series?: number[] }) {
  return (
    <div className="p-2 rounded bg-term-panel2 border border-term-line/40 space-y-1">
      <div className="text-xxs text-term-dim">{title}</div>
      <div className="flex items-center justify-between">
        <span className="font-bold text-term-text">{val}</span>
        {series && series.length > 1 && (
          <Sparkline data={series} width={60} height={16} color="#fbbf24" strokeWidth={1} />
        )}
      </div>
    </div>
  );
}
