"use client";

/**
 * WO-30 §2.2 — Barra de veracidade.
 *
 * Uma linha, sempre visível, declarando a proveniência de CADA fonte que alimenta a tela.
 * Existe porque a plataforma exibia três datas distintas (histórico de hoje, chain de D-1,
 * posições em aberto de D-3) todas como se fossem "agora". Sem esta barra, nenhuma outra
 * correção adianta: é ela que devolve ao trader o direito de julgar o número.
 */

import { useMarket } from "@/store/market";
import { sessionInfo } from "@/lib/session";
import { construirProvenance, corFrescor, rotuloFrescor, fmtPreco, type DataProvenance } from "@/lib/provenance";
import { fmtDateBR } from "@/lib/format";

function Bloco({ label, prov, extra }: { label: string; prov: DataProvenance; extra?: string }) {
  const data = prov.dataDoDado ? fmtDateBR(prov.dataDoDado) : "—";
  return (
    <span
      className="whitespace-nowrap"
      title={`${prov.fonte} · dado de ${data}${prov.horaDoDado ? " " + prov.horaDoDado : ""}${
        prov.idadePregoes != null ? ` · ${prov.idadePregoes} pregão(ões) de defasagem` : ""
      }`}
    >
      <span className="text-term-dim">{label} </span>
      <span className={corFrescor(prov.frescor)}>
        {data}
        {prov.frescor !== "AO_VIVO" && prov.frescor !== "FECHAMENTO" ? ` (${rotuloFrescor(prov)})` : ""}
      </span>
      {extra ? <span className="text-term-dim"> {extra}</span> : null}
    </span>
  );
}

export function TruthBar({
  oiFileDate = null,
  oiUpdatedAt,
}: {
  /** Data do arquivo de posições em aberto da B3. Passe quando a tela usa GEX. */
  oiFileDate?: string | null;
  oiUpdatedAt?: string;
}) {
  const chain = useMarket((s) => s.chain);
  const ticker = useMarket((s) => s.ticker);
  const sess = sessionInfo();

  if (!chain) return null;

  const provChain = construirProvenance("opcoes.net.br", chain.dataEfetiva, {
    buscadoEm: chain.fetchedAt ?? chain.updatedAt,
    refSession: sess.ultimaSessao,
  });
  const provSpot = construirProvenance("Yahoo Finance (fechamento)", chain.spotDate, {
    buscadoEm: chain.fetchedAt ?? chain.updatedAt,
    refSession: sess.ultimaSessao,
  });
  const provOi = construirProvenance("B3 DerivativesOpenPosition", oiFileDate, {
    buscadoEm: oiUpdatedAt ?? new Date().toISOString(),
    refSession: sess.ultimaSessao,
  });

  const cob = chain.cobertura;

  return (
    <div className="panel px-3 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xxs font-mono">
      <span className="whitespace-nowrap">
        <span className="text-term-cyan font-semibold">{ticker}</span>{" "}
        <span className="text-term-fg">{fmtPreco(chain.spot)}</span>
      </span>

      <Bloco label="SPOT" prov={provSpot} />
      <Bloco label="CHAIN" prov={provChain} />
      {oiFileDate && <Bloco label="OI B3" prov={provOi} />}

      <span className="whitespace-nowrap text-term-dim" title="Nenhuma grega vem da fonte; todas são calculadas pelo engine local.">
        GREGAS <span className="text-term-amber">ENGINE LOCAL</span>
      </span>

      {cob && (
        <span
          className="whitespace-nowrap text-term-dim"
          title={`${cob.comPremio} séries têm prêmio; ${cob.negociadasNaDataEfetiva} negociaram na data efetiva do chain.${
            cob.premioMaisAntigo ? ` Prêmio mais antigo ainda exibido: ${fmtDateBR(cob.premioMaisAntigo)}.` : ""
          }`}
        >
          COBERTURA{" "}
          <span className={cob.negociadasNaDataEfetiva / Math.max(cob.total, 1) < 0.5 ? "text-term-amber" : "text-term-fg"}>
            {cob.negociadasNaDataEfetiva}/{cob.total}
          </span>{" "}
          negociadas
        </span>
      )}
    </div>
  );
}
