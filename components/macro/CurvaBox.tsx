"use client";

/**
 * WO-32 — Box reutilizável de curva de juros para a aba Rates & FX.
 *
 * Cada box carrega a DATA DO DADO no cabeçalho, nunca a do fetch (WO-30 §2.1) — e o rótulo
 * muda para "FECHAMENTO dd/mm" quando o pregão está fechado, em vez de esvaziar a tela.
 */

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import { fmtDateBR } from "@/lib/format";
import { construirProvenance, corFrescor } from "@/lib/provenance";
import { sessionInfo } from "@/lib/session";

export interface PontoCurva {
  rotulo: string;
  anos: number;
  valor: number | null;
}

interface Props {
  titulo: string;
  fonte: string;
  /** YYYY-MM-DD — a data à que o dado se refere. */
  dataDoDado: string | null;
  pontos: PontoCurva[];
  /**
   * Série alternativa para o gráfico. Quando informada, o gráfico plota esta série e a tabela
   * segue mostrando `pontos` — é o caso do BRL/USD: preço no gráfico, janelas na tabela.
   */
  serie?: { rotulo: string; valor: number }[];
  /** Sufixo da unidade no eixo e no tooltip. */
  unidade?: string;
  /** Marca a série como derivada (interpolada/calculada), não observada. */
  estimado?: boolean;
  /** Explicação do chip EST ou do vazio. */
  nota?: string;
  cor?: string;
  /** Texto do estado vazio quando não há pontos. */
  vazio?: string;
  /**
   * "curva" (padrão): colunas Vértice/Anos/Taxa. "janelas": Janela/Variação — usado no BRL/USD,
   * onde prazo em anos não significa nada e o eixo X é apenas a ordem dos pregões.
   */
  tipoTabela?: "curva" | "janelas";
}

export function CurvaBox({
  titulo,
  fonte,
  dataDoDado,
  pontos,
  serie,
  unidade = "%",
  estimado = false,
  nota,
  cor = "#22d3ee",
  vazio = "Sem dados para esta curva nesta execução.",
  tipoTabela = "curva",
}: Props) {
  const ehJanelas = tipoTabela === "janelas";
  const sess = sessionInfo();
  const prov = construirProvenance(fonte, dataDoDado);
  const comValor = pontos.filter((p) => p.valor != null);
  const dadosGrafico = serie && serie.length > 0 ? serie : comValor;
  const unidadeGrafico = serie && serie.length > 0 ? "" : unidade;

  // Fora do pregão o rótulo diz FECHAMENTO — nada some da tela.
  const carimbo = dataDoDado
    ? sess.state === "ABERTO" && prov.idadePregoes === 0
      ? fmtDateBR(dataDoDado)
      : `FECHAMENTO ${fmtDateBR(dataDoDado)}`
    : "—";

  return (
    <div className="space-y-2 p-3 bg-term-panel rounded border border-term-line/60 flex flex-col">
      <div className="flex items-center justify-between border-b border-term-line/40 pb-2 gap-2">
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

      {comValor.length === 0 && dadosGrafico.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xxs text-term-dim text-center px-4 py-8">
          {nota ?? vazio}
        </div>
      ) : (
        <>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dadosGrafico} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" />
                <XAxis
                  dataKey="rotulo"
                  tick={ehJanelas ? false : { fontSize: 9, fill: "#6b7280" }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "#6b7280" }}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => `${Number(v).toFixed(1)}`}
                />
                <Tooltip
                  contentStyle={{ background: "#0b0f14", border: "1px solid #1f2937", fontSize: 11 }}
                  formatter={(v: any) => [`${Number(v).toFixed(2)}${unidadeGrafico}`, titulo]}
                />
                <Line type="monotone" dataKey="valor" stroke={cor} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="max-h-32 overflow-y-auto">
            <table className="w-full text-xxs font-mono">
              <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
                <tr className="text-term-dim">
                  <th className="text-left py-1">{ehJanelas ? "Janela" : "Vértice"}</th>
                  {!ehJanelas && <th className="text-right py-1">Anos</th>}
                  <th className="text-right py-1">{ehJanelas ? "Variação" : "Taxa"}</th>
                </tr>
              </thead>
              <tbody>
                {pontos.map((p) => (
                  <tr key={p.rotulo} className="border-b border-term-line/20">
                    <td className="py-0.5 text-left">{p.rotulo}</td>
                    {!ehJanelas && <td className="py-0.5 text-right text-term-dim">{p.anos.toFixed(1)}</td>}
                    <td
                      className={clsx(
                        "py-0.5 text-right font-semibold",
                        p.valor == null ? "text-term-dim" : ehJanelas ? (p.valor >= 0 ? "text-term-up" : "text-term-down") : "text-term-fg"
                      )}
                    >
                      {p.valor == null ? "—" : `${ehJanelas && p.valor > 0 ? "+" : ""}${p.valor.toFixed(2)}${unidade}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nota && <div className="text-xxs text-term-dim pt-1">{nota}</div>}
        </>
      )}
    </div>
  );
}
