"use client";

/**
 * WO-33 — Uma variável do painel Rates & FX ocupa uma linha com dois painéis:
 *
 *   ┌──────────────────────────┬──────────────────────────┐
 *   │ ESTRUTURA A TERMO        │ VARIAÇÕES                │
 *   │ nível de hoje, 1 linha   │ overlay 1D/5D/1M/3M      │
 *   │ todos os vértices        │ + tabela Δ em bps        │
 *   └──────────────────────────┴──────────────────────────┘
 *
 * O painel da direita replica o que o Treasuries já tinha; o da esquerda isola o nível para
 * que a leitura de formato da curva não dispute espaço com as linhas históricas.
 *
 * Proveniência: uma tarja por linha, sempre com a DATA DO DADO — nunca a do fetch (WO-30 §2.1).
 */

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import clsx from "clsx";
import { fmtDateBR, fmtNum } from "@/lib/format";
import { construirProvenance, corFrescor } from "@/lib/provenance";
import { sessionInfo } from "@/lib/session";

export interface SerieGrafico {
  chave: string;
  nome: string;
  cor: string;
  tracejada?: boolean;
  opacidade?: number;
}

export interface ColunaTabela {
  chave: string;
  rotulo: string;
  /** `taxa` → 13,56% · `bps` → +1,0 com cor · `pct` → +0,60% com cor · `texto` → cru */
  tipo: "taxa" | "bps" | "pct" | "texto";
}

interface Props {
  titulo: string;
  fonte: string;
  dataDoDado: string | null;
  estimado?: boolean;
  nota?: string;
  /** Painel esquerdo — nível de hoje. */
  nivel: { dados: any[]; xKey: string; series: SerieGrafico[]; unidade?: string };
  /** Painel direito — overlay histórico. */
  variacao: { dados: any[]; xKey: string; series: SerieGrafico[]; unidade?: string };
  /** Tabela sob o painel direito. */
  tabela: { colunas: ColunaTabela[]; linhas: any[] };
  vazio?: string;
  /**
   * WO-34 §A: `somenteVariacao` renderiza só o painel da direita (overlay + tabela de deltas).
   * Para Pré e Treasuries o nível já se lê na coluna TAXA da tabela — o painel de estrutura a
   * termo gastava metade da largura sem acrescentar informação.
   */
  modo?: "duplo" | "somenteVariacao";
}

/** Δ em pontos percentuais → bps na tela. `null` vira "—": zero afirmaria "não mudou". */
function fmtBps(v: unknown): { texto: string; classe: string } {
  if (v == null || !Number.isFinite(Number(v))) return { texto: "—", classe: "text-term-dim" };
  const bps = Number(v) * 100;
  const texto = `${bps >= 0 ? "+" : ""}${fmtNum(bps, 1)}`;
  // Juro subindo é aperto: vermelho. Mantém a convenção que o Treasuries já usava.
  return { texto, classe: bps > 0 ? "text-term-down" : bps < 0 ? "text-term-up" : "text-term-dim" };
}

function fmtPct(v: unknown): { texto: string; classe: string } {
  if (v == null || !Number.isFinite(Number(v))) return { texto: "—", classe: "text-term-dim" };
  const n = Number(v);
  return {
    texto: `${n >= 0 ? "+" : ""}${fmtNum(n, 2)}%`,
    classe: n > 0 ? "text-term-up" : n < 0 ? "text-term-down" : "text-term-dim",
  };
}

function Grafico({
  dados,
  xKey,
  series,
  unidade,
  altura,
}: {
  dados: any[];
  xKey: string;
  series: SerieGrafico[];
  unidade?: string;
  altura: number;
}) {
  if (!dados || dados.length === 0) {
    return (
      <div style={{ height: altura }} className="flex items-center justify-center text-xxs text-term-dim">
        sem dados
      </div>
    );
  }
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
          <XAxis dataKey={xKey} stroke="#6b7689" fontSize={9} interval="preserveStartEnd" minTickGap={20} />
          <YAxis stroke="#6b7689" fontSize={9} domain={["auto", "auto"]} tickFormatter={(v) => fmtNum(Number(v), 1)} />
          <Tooltip
            contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
            formatter={(v: any, nome: any) => [`${fmtNum(Number(v), 2)}${unidade ?? "%"}`, nome]}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 9, fontFamily: "monospace" }} />}
          {series.map((s) => (
            <Line
              key={s.chave}
              type="monotone"
              dataKey={s.chave}
              name={s.nome}
              stroke={s.cor}
              strokeWidth={s.tracejada ? 1.2 : 2}
              strokeDasharray={s.tracejada ? "3 3" : undefined}
              strokeOpacity={s.opacidade ?? 1}
              dot={s.tracejada ? false : { r: 2.5 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LinhaRates({ titulo, fonte, dataDoDado, estimado, nota, nivel, variacao, tabela, vazio, modo = "duplo" }: Props) {
  const soVariacao = modo === "somenteVariacao";
  const sess = sessionInfo();
  const prov = construirProvenance(fonte, dataDoDado);
  const carimbo = dataDoDado
    ? sess.state === "ABERTO" && prov.idadePregoes === 0
      ? fmtDateBR(dataDoDado)
      : `FECHAMENTO ${fmtDateBR(dataDoDado)}`
    : "—";

  const semDados = (nivel.dados?.length ?? 0) === 0 && (tabela.linhas?.length ?? 0) === 0;

  return (
    <div className="bg-term-panel rounded border border-term-line/60">
      {/* Cabeçalho da linha: título + proveniência única para os dois painéis */}
      <div className="flex items-center justify-between border-b border-term-line/40 px-3 py-2 gap-2">
        <span className="font-bold text-xs text-term-cyan">{titulo}</span>
        <div className="flex items-center gap-1 whitespace-nowrap">
          {estimado && (
            <span className="tag bg-term-gold/20 text-term-gold" title={nota ?? "Série derivada, não observada."}>
              EST
            </span>
          )}
          <span
            className={clsx("tag bg-term-panel2", corFrescor(prov.frescor))}
            title={`${fonte} · dado de ${dataDoDado ? fmtDateBR(dataDoDado) : "—"}${
              prov.idadePregoes ? ` · ${prov.idadePregoes} pregão(ões) de defasagem` : ""
            }`}
          >
            {carimbo}
            {prov.idadePregoes && prov.idadePregoes > 0 ? ` (D-${prov.idadePregoes})` : ""}
          </span>
        </div>
      </div>

      {semDados ? (
        <div className="px-3 py-8 text-center text-xxs text-term-dim">{vazio ?? "Sem dados nesta execução."}</div>
      ) : (
        <div className={clsx("gap-3 p-3", soVariacao ? "block" : "grid grid-cols-1 lg:grid-cols-2")}>
          {/* ESQUERDA — estrutura a termo (omitida no modo somenteVariacao) */}
          {!soVariacao && (
            <div>
              <div className="text-xxs text-term-dim uppercase tracking-wider mb-1">Estrutura a termo</div>
              <Grafico dados={nivel.dados} xKey={nivel.xKey} series={nivel.series} unidade={nivel.unidade} altura={200} />
            </div>
          )}

          {/* DIREITA — variações */}
          <div>
            <div className="text-xxs text-term-dim uppercase tracking-wider mb-1">Variações</div>
            <Grafico dados={variacao.dados} xKey={variacao.xKey} series={variacao.series} unidade={variacao.unidade} altura={200} />

            <div className="max-h-40 overflow-y-auto mt-2">
              <table className="w-full text-xxs font-mono">
                <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
                  <tr className="text-term-dim">
                    {tabela.colunas.map((c, i) => (
                      <th key={c.chave} className={clsx("py-1", i === 0 ? "text-left" : "text-right")}>
                        {c.rotulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabela.linhas.map((l, idx) => (
                    <tr key={idx} className="border-b border-term-line/20">
                      {tabela.colunas.map((c, i) => {
                        const bruto = l[c.chave];
                        let conteudo: string = bruto == null ? "—" : String(bruto);
                        let classe = "text-term-fg";
                        if (c.tipo === "taxa") {
                          conteudo = bruto == null ? "—" : `${fmtNum(Number(bruto), 2)}%`;
                          classe = "font-semibold";
                        } else if (c.tipo === "bps") {
                          const f = fmtBps(bruto);
                          conteudo = f.texto;
                          classe = f.classe;
                        } else if (c.tipo === "pct") {
                          const f = fmtPct(bruto);
                          conteudo = f.texto;
                          classe = f.classe;
                        } else if (i === 0) {
                          classe = "text-term-fg";
                        }
                        return (
                          <td key={c.chave} className={clsx("py-0.5", i === 0 ? "text-left" : "text-right", classe)}>
                            {conteudo}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {nota && <div className="px-3 pb-2 text-xxs text-term-dim">{nota}</div>}
    </div>
  );
}
