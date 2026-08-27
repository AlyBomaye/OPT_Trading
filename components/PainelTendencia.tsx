"use client";

/**
 * WO-44 — Visualização de tendência.
 *
 * O WO-43 criou a camada de regime — a marcação do trader sobre a tendência de cada ativo — mas
 * nenhuma tela a mostrava. Marcação que não se vê não vira feedback: o trader não consegue
 * responder a pergunta que mais importa depois de algumas semanas de método, que é **as minhas
 * leituras de tendência estavam certas?**
 *
 * Este painel plota o preço do ativo com as **faixas de regime pintadas ao fundo**, uma cor por
 * período marcado. A comparação fica visual e imediata: onde você marcou alta, o preço subiu?
 *
 * Duas decisões que valem registrar:
 *
 * 1. **Ele não sugere tendência.** O manual declara que os parâmetros do indicador por ativo são
 *    proprietários. A tela mostra o que VOCÊ marcou contra o que o preço FEZ — e nada mais. Isso é
 *    feedback honesto; um palpite de tendência nosso seria um indicador diferente disfarçado.
 * 2. **Marcação sem data é recusada.** O campo pede a data do PREGÃO observado, não a de hoje, para
 *    a faixa começar onde a virada aconteceu (WO-30 §2.1).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, HelpCircle, Check } from "lucide-react";
import clsx from "clsx";
import { fmtDateBR, fmtNum } from "@/lib/format";
import { REGIMES, type Regime } from "@/lib/metodo";
import type { Candle } from "@/app/api/history/route";

const COR_REGIME: Record<Regime, { faixa: string; texto: string; icone: typeof TrendingUp }> = {
  alta: { faixa: "#00c805", texto: "text-term-up", icone: TrendingUp },
  baixa: { faixa: "#ff3b30", texto: "text-term-down", icone: TrendingDown },
  lateral: { faixa: "#fbbf24", texto: "text-term-gold", icone: Minus },
  indefinido: { faixa: "#7a8499", texto: "text-term-dim", icone: HelpCircle },
};

interface Marcacao {
  ticker: string;
  regime: Regime;
  observadoEm: string;
  nota: string | null;
}

/** Uma faixa contínua de mesmo regime: da marcação até a marcação seguinte (ou até hoje). */
interface FaixaRegime {
  regime: Regime;
  de: string;
  ate: string;
}

/**
 * Converte marcações pontuais em faixas contínuas.
 *
 * Cada marcação vale **até a próxima**. A última se estende até o fim da série — é o regime
 * vigente. Marcações fora da janela do gráfico são descartadas na plotagem, mas a que vier antes
 * do início precisa ser preservada, senão o começo do gráfico fica sem cor por um detalhe de
 * recorte.
 */
export function montarFaixas(marcacoes: Marcacao[], primeiraData: string, ultimaData: string): FaixaRegime[] {
  const ordenadas = [...marcacoes].sort((a, b) => (a.observadoEm < b.observadoEm ? -1 : 1));
  if (ordenadas.length === 0) return [];

  const faixas: FaixaRegime[] = [];
  for (let i = 0; i < ordenadas.length; i++) {
    const atual = ordenadas[i];
    const proxima = ordenadas[i + 1];
    const de = atual.observadoEm < primeiraData ? primeiraData : atual.observadoEm;
    const ate = proxima ? proxima.observadoEm : ultimaData;
    if (ate < primeiraData || de > ultimaData) continue;
    faixas.push({ regime: atual.regime, de, ate: ate > ultimaData ? ultimaData : ate });
  }
  return faixas;
}

interface Props {
  ticker: string;
  /** Quantos pregões mostrar. 120 ≈ 6 meses, que cobre bem a recalibração de 4 meses do método. */
  pregoes?: number;
}

export function PainelTendencia({ ticker, pregoes = 120 }: Props) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [marcacoes, setMarcacoes] = useState<Marcacao[]>([]);
  const [semBanco, setSemBanco] = useState(false);
  const [carregando, setCarregando] = useState(false);

  // Formulário de marcação
  const [novoRegime, setNovoRegime] = useState<Regime>("alta");
  const [novaData, setNovaData] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [h, r] = await Promise.all([
        fetch(`/api/history?ticker=${encodeURIComponent(ticker)}&range=1y`, {
          signal: AbortSignal.timeout(30_000),
        }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
        fetch(`/api/regime?ticker=${encodeURIComponent(ticker)}`, {
          signal: AbortSignal.timeout(15_000),
        }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      ]);
      setCandles(Array.isArray(h?.candles) ? h.candles : null);
      setSemBanco(r?.configurado === false);
      setMarcacoes(Array.isArray(r?.historico) ? r.historico : []);
    } finally {
      setCarregando(false);
    }
  }, [ticker]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // A data padrão é o último pregão da série, não "hoje": é dele que o trader está lendo o gráfico.
  useEffect(() => {
    if (novaData === "" && candles && candles.length > 0) {
      setNovaData(candles[candles.length - 1].date);
    }
  }, [candles, novaData]);

  const serie = useMemo(() => (candles ?? []).slice(-pregoes), [candles, pregoes]);

  const faixas = useMemo(() => {
    if (serie.length === 0) return [];
    return montarFaixas(marcacoes, serie[0].date, serie[serie.length - 1].date);
  }, [marcacoes, serie]);

  const vigente = marcacoes.length > 0
    ? [...marcacoes].sort((a, b) => (a.observadoEm < b.observadoEm ? 1 : -1))[0]
    : null;

  const marcar = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(novaData)) {
      setAviso("Informe a data do pregão em que você observou a virada.");
      return;
    }
    setSalvando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/regime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, regime: novoRegime, observadoEm: novaData }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = await res.json();
      setAviso(j?.mensagem ?? j?.error ?? null);
      if (j?.gravado) await carregar();
    } catch (e: any) {
      setAviso(`Não foi possível gravar: ${e?.message ?? "erro desconhecido"}`);
    } finally {
      setSalvando(false);
    }
  };

  const Icone = vigente ? COR_REGIME[vigente.regime].icone : HelpCircle;

  return (
    <div className="panel border border-term-line bg-term-panel rounded">
      <div className="panel-title flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icone size={14} className={vigente ? COR_REGIME[vigente.regime].texto : "text-term-dim"} />
          <span className="font-bold">Tendência de {ticker}</span>
        </div>
        {vigente ? (
          <span className={clsx("tag bg-term-panel2 whitespace-nowrap", COR_REGIME[vigente.regime].texto)}>
            {vigente.regime.toUpperCase()} desde {fmtDateBR(vigente.observadoEm)}
          </span>
        ) : (
          <span className="tag bg-term-panel2 text-term-dim">sem marcação</span>
        )}
      </div>

      <div className="p-3 space-y-3">
        <p className="text-xxs text-term-dim leading-relaxed">
          As faixas coloridas são <b>as suas marcações</b>, não um indicador calculado — a plataforma
          não estima tendência. O que esta tela mostra é o que você leu contra o que o preço fez, para
          você conferir depois se a leitura estava certa.
        </p>

        {serie.length === 0 ? (
          <div className="px-3 py-8 text-center text-xxs text-term-dim">
            {carregando ? "Carregando a série do ativo…" : "Sem série histórica para este ativo."}
          </div>
        ) : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serie} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#6b7689" fontSize={9} interval="preserveStartEnd" minTickGap={40}
                  tickFormatter={(d) => String(d).slice(5)} />
                <YAxis stroke="#6b7689" fontSize={9} domain={["auto", "auto"]}
                  tickFormatter={(v) => fmtNum(Number(v), 2)} />
                <Tooltip
                  contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                  labelFormatter={(d) => fmtDateBR(String(d))}
                  formatter={(v: any) => [`R$ ${fmtNum(Number(v), 2)}`, "Fechamento"]}
                />
                {/* As faixas vêm antes da linha para ficarem ao fundo. */}
                {faixas.map((f, i) => (
                  <ReferenceArea
                    key={`${f.de}-${i}`}
                    x1={f.de}
                    x2={f.ate}
                    fill={COR_REGIME[f.regime].faixa}
                    fillOpacity={0.10}
                    stroke={COR_REGIME[f.regime].faixa}
                    strokeOpacity={0.25}
                  />
                ))}
                <Line type="monotone" dataKey="close" name="Fechamento" stroke="#22d3ee" strokeWidth={1.8} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Marcação */}
        <div className="border-t border-term-line/40 pt-3">
          <div className="text-xxs text-term-dim uppercase tracking-wider mb-1.5">Marcar tendência</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {REGIMES.map((r) => {
              const I = COR_REGIME[r.valor].icone;
              return (
                <button
                  key={r.valor}
                  onClick={() => setNovoRegime(r.valor)}
                  title={r.descricao}
                  className={clsx(
                    "flex items-center gap-1 px-2 py-1 text-xxs font-mono rounded border transition-colors",
                    novoRegime === r.valor
                      ? "bg-term-cyan/15 border-term-cyan/50 text-term-cyan"
                      : "bg-term-panel2 border-term-line text-term-dim hover:text-term-text"
                  )}
                >
                  <I size={11} />
                  {r.rotulo}
                </button>
              );
            })}

            <input
              type="date"
              value={novaData}
              onChange={(e) => setNovaData(e.target.value)}
              title="Data do PREGÃO em que você observou a virada — não a de hoje"
              className="bg-term-panel2 border border-term-line rounded px-2 py-1 text-xxs font-mono text-term-text outline-none focus:border-term-cyan"
            />

            <button
              onClick={marcar}
              disabled={salvando}
              className="btn btn-primary text-xxs py-1 px-2.5 flex items-center gap-1 disabled:opacity-60"
            >
              <Check size={11} />
              {salvando ? "Gravando…" : "Marcar"}
            </button>
          </div>

          {semBanco && (
            <div className="mt-2 text-xxs text-term-gold bg-term-gold/10 border border-term-gold/30 rounded px-2 py-1.5">
              Banco não configurado — a marcação não fica salva. Rode <code>npm run setup:db</code>.
            </div>
          )}
          {aviso && !semBanco && <div className="mt-2 text-xxs text-term-dim">{aviso}</div>}

          {marcacoes.length > 0 && (
            <div className="mt-2 text-xxs font-mono text-term-dim">
              {marcacoes.length} marcação(ões) no histórico · a mais antiga em{" "}
              {fmtDateBR([...marcacoes].sort((a, b) => (a.observadoEm < b.observadoEm ? -1 : 1))[0].observadoEm)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
