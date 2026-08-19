"use client";

/**
 * WO-35 §B — Um indicador do Boletim Focus ocupa uma linha com dois painéis:
 *
 *   ┌──────────────────────────────┬──────────────────────────────┐
 *   │ EVOLUÇÃO DA PROJEÇÃO (12 M)  │ PROJEÇÃO POR HORIZONTE       │
 *   │ x = data da coleta           │ tabela por ano de referência │
 *   │ uma linha por ano            │ + Δ 1D / 5D / 1M / 3M        │
 *   └──────────────────────────────┴──────────────────────────────┘
 *
 * A gramática visual é a de `LinhaRates` — tarja de proveniência no cabeçalho, dois painéis,
 * tabela com cor por sinal — mas a semântica é outra: aqui o eixo x é o TEMPO DA COLETA, não o
 * prazo. O que se lê é a revisão da expectativa, não o formato de uma curva.
 *
 * Proveniência (WO-40): a tarja mostra a data de COLETA do Focus — nunca a do fetch (WO-30 §2.1)
 * — e é julgada pela CADÊNCIA DO BOLETIM, não pela régua de um dado diário.
 *
 * O boletim sai toda segunda por volta das 8h25 carregando as expectativas coletadas até a SEXTA
 * anterior. Logo, entre uma segunda e a seguinte, a coleta mais nova possível é sempre aquela
 * sexta. Julgando pela régua diária, um boletim recém-publicado aparecia com 3 pregões de idade e
 * a tarja saía VERMELHA — alarme disparando com a fonte em dia, que é o que ensina a ignorar
 * alarme (mesma disciplina de causa do WO-34).
 */

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import { fmtDateBR, fmtNum } from "@/lib/format";
import { avaliarPublicacao } from "@/lib/focus";
import type { SerieFocus } from "@/lib/focus";

/** Cores por ano de referência: o mais próximo é o mais forte, como nas curvas de Rates. */
const CORES_ANO = ["#22d3ee", "#a78bfa", "#f59e0b", "#64748b", "#475569"];

/** Quantos anos entram no gráfico. A tabela mostra todos; o gráfico com 5 linhas vira borrão. */
const ANOS_NO_GRAFICO = 3;

function corDelta(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "text-term-dim";
  // Expectativa subindo é revisão para cima — âmbar; para baixo, ciano. Sem juízo de valor:
  // IPCA subindo é ruim, PIB subindo é bom, então a cor marca direção, não qualidade.
  return v > 0 ? "text-term-gold" : v < 0 ? "text-term-cyan" : "text-term-dim";
}

/**
 * `null` vira "—" (não medido); zero vira "0,00" sem sinal (medido e não mudou). São coisas
 * diferentes e a tela precisa distingui-las — "+0,00" confundiria as duas.
 */
function fmtDelta(v: number | null, casas: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const texto = fmtNum(v, casas);
  // fmtNum arredonda: 0,001 vira "0,00" e não merece sinal de alta.
  if (/^-?0(,0+)?$/.test(texto)) return texto.replace("-", "");
  return `${v > 0 ? "+" : ""}${texto}`;
}

export function PainelFocus({ serie }: { serie: SerieFocus }) {
  const pub = avaliarPublicacao(serie.dataDoDado);

  const anosGrafico = serie.horizontes.slice(0, ANOS_NO_GRAFICO).map((h) => h.ano);

  // Pivota a série: uma linha por data de coleta, uma coluna por ano de referência.
  const dadosGrafico = (() => {
    const porData = new Map<string, Record<string, number | string>>();
    for (const p of serie.pontos) {
      if (!anosGrafico.includes(p.ano)) continue;
      if (!porData.has(p.data)) porData.set(p.data, { data: p.data.slice(5) });
      porData.get(p.data)![p.ano] = p.mediana;
    }
    return Array.from(porData.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, linha]) => linha);
  })();

  const semDados = serie.pontos.length === 0;

  return (
    <div className="bg-term-panel rounded border border-term-line/60">
      <div className="flex items-center justify-between border-b border-term-line/40 px-3 py-2 gap-2">
        <span className="font-bold text-xs text-term-cyan">
          {serie.rotulo}
          <span className="text-term-dim font-normal"> — mediana das projeções</span>
        </span>
        <span
          className={clsx("tag bg-term-panel2 whitespace-nowrap", pub.emDia ? "text-term-cyan" : "text-term-gold")}
          title={
            pub.emDia
              ? `BCB · Boletim Focus · coleta de ${serie.dataDoDado ? fmtDateBR(serie.dataDoDado) : "—"}. É o boletim mais recente publicado: o de segunda carrega as expectativas coletadas até a sexta anterior.`
              : `Atrasado: a coleta esperada seria ${fmtDateBR(pub.esperada)} e temos ${serie.dataDoDado ? fmtDateBR(serie.dataDoDado) : "nenhuma"}.`
          }
        >
          {serie.dataDoDado ? `COLETA ${fmtDateBR(serie.dataDoDado)}` : "—"}
          {pub.emDia ? " · EM DIA" : ` · ${pub.boletinsAtraso} BOLETIM(NS) ATRÁS`}
        </span>
      </div>

      {semDados ? (
        <div className="px-3 py-8 text-center text-xxs text-term-dim">
          Sem projeções para este indicador na janela de 12 meses.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3">
          {/* ESQUERDA — como a projeção foi sendo revista ao longo do último ano */}
          <div>
            <div className="text-xxs text-term-dim uppercase tracking-wider mb-1">
              Evolução da projeção (12 meses)
            </div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dadosGrafico} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                  <XAxis dataKey="data" stroke="#6b7689" fontSize={9} interval="preserveStartEnd" minTickGap={28} />
                  <YAxis
                    stroke="#6b7689"
                    fontSize={9}
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => fmtNum(Number(v), serie.casas)}
                  />
                  <Tooltip
                    contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                    formatter={(v: any, nome: any) => [`${fmtNum(Number(v), serie.casas)} ${serie.unidade}`, nome]}
                  />
                  <Legend wrapperStyle={{ fontSize: 9, fontFamily: "monospace" }} />
                  {anosGrafico.map((ano, i) => (
                    <Line
                      key={ano}
                      type="monotone"
                      dataKey={ano}
                      name={ano}
                      stroke={CORES_ANO[i] ?? "#64748b"}
                      strokeWidth={i === 0 ? 2 : 1.4}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* DIREITA — onde a projeção está hoje e quanto foi revista */}
          <div>
            <div className="text-xxs text-term-dim uppercase tracking-wider mb-1">
              Projeção por horizonte · revisão
            </div>
            <div className="max-h-[232px] overflow-y-auto">
              <table className="w-full text-xxs font-mono">
                <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
                  <tr className="text-term-dim">
                    <th className="py-1 text-left">ANO</th>
                    <th className="py-1 text-right">MEDIANA</th>
                    <th className="py-1 text-right">Δ 1D</th>
                    <th className="py-1 text-right">Δ 5D</th>
                    <th className="py-1 text-right">Δ 1M</th>
                    <th className="py-1 text-right">Δ 3M</th>
                    <th className="py-1 text-right">RESP.</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.horizontes.map((h) => (
                    <tr key={h.ano} className="border-b border-term-line/20">
                      <td className="py-1 text-left text-term-fg">{h.ano}</td>
                      <td className="py-1 text-right font-semibold text-term-fg">
                        {h.mediana != null ? fmtNum(h.mediana, serie.casas) : "—"}
                      </td>
                      <td className={clsx("py-1 text-right", corDelta(h.d1))}>{fmtDelta(h.d1, serie.casas)}</td>
                      <td className={clsx("py-1 text-right", corDelta(h.d5))}>{fmtDelta(h.d5, serie.casas)}</td>
                      <td className={clsx("py-1 text-right", corDelta(h.d21))}>{fmtDelta(h.d21, serie.casas)}</td>
                      <td className={clsx("py-1 text-right", corDelta(h.d63))}>{fmtDelta(h.d63, serie.casas)}</td>
                      <td className="py-1 text-right text-term-dim">{h.respondentes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xxs text-term-dim mt-2 leading-relaxed">
              Δ compara a mediana de hoje com a de 1, 5, 21 e 63 coletas atrás, casando por data —
              coleta ausente vira “—”, não zero. Unidade: {serie.unidade}.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Trajetória da Selic esperada reunião a reunião do Copom.
 *
 * Painel de largura inteira e eixo próprio: aqui o x é a REUNIÃO, não a data de coleta nem o
 * prazo. É a leitura que conversa diretamente com a curva Pré em Rates & FX — uma é a expectativa
 * declarada pelos economistas, a outra é o preço que o mercado efetivamente paga.
 */
export function PainelCopom({
  pontos,
  dataDoDado,
}: {
  pontos: Array<{ reuniao: string; mediana: number; respondentes: number | null }>;
  dataDoDado: string | null;
}) {
  const pub = avaliarPublicacao(dataDoDado);

  return (
    <div className="bg-term-panel rounded border border-term-line/60">
      <div className="flex items-center justify-between border-b border-term-line/40 px-3 py-2 gap-2">
        <span className="font-bold text-xs text-term-cyan">
          Trajetória da Selic
          <span className="text-term-dim font-normal"> — mediana esperada por reunião do Copom</span>
        </span>
        <span className={clsx("tag bg-term-panel2 whitespace-nowrap", pub.emDia ? "text-term-cyan" : "text-term-gold")}>
          {dataDoDado ? `COLETA ${fmtDateBR(dataDoDado)}` : "—"}
          {pub.emDia ? " · EM DIA" : ` · ${pub.boletinsAtraso} BOLETIM(NS) ATRÁS`}
        </span>
      </div>

      {pontos.length === 0 ? (
        <div className="px-3 py-8 text-center text-xxs text-term-dim">
          Trajetória do Copom indisponível nesta atualização.
        </div>
      ) : (
        <div className="p-3">
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pontos} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                <XAxis dataKey="reuniao" stroke="#6b7689" fontSize={9} interval="preserveStartEnd" minTickGap={16} />
                <YAxis stroke="#6b7689" fontSize={9} domain={["auto", "auto"]} tickFormatter={(v) => fmtNum(Number(v), 2)} />
                <Tooltip
                  contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                  formatter={(v: any) => [`${fmtNum(Number(v), 2)}% a.a.`, "Mediana"]}
                />
                <Line type="stepAfter" dataKey="mediana" name="Selic esperada" stroke="#22d3ee" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xxs text-term-dim mt-2 leading-relaxed">
            Degraus, não curva: a Selic só muda em reunião. Compare com a curva Pré em Rates &amp; FX —
            quando as duas divergem, o mercado está pagando algo diferente do que os economistas dizem esperar.
          </div>
        </div>
      )}
    </div>
  );
}
