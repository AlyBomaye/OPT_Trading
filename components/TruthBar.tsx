"use client";

/**
 * WO-30 §2.2 — Barra de veracidade.
 *
 * Uma linha, sempre visível, declarando a proveniência de CADA fonte que alimenta a tela.
 * Existe porque a plataforma exibia três datas distintas (histórico de hoje, chain de D-1,
 * posições em aberto de D-3) todas como se fossem "agora". Sem esta barra, nenhuma outra
 * correção adianta: é ela que devolve ao trader o direito de julgar o número.
 *
 * WO-61: a fonte deixou de ser uma string fixa. A cadeia diz de onde veio (`chain.fonte`,
 * `chain.fonteDetalhe`: "MT5 · Genial · tick 16:54:57" ou "opcoes.net.br · último negócio"), o spot
 * idem (tick do MT5 na sessão corrente, ou fechamento do histórico), e o chip BOOK conta as séries
 * com bid e ask — ao vivo (MT5) ou de fechamento (COTAHIST).
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

  const viaMt5 = chain.fonte === "mt5";
  const horaTick = viaMt5 && chain.spotTickAt ? chain.spotTickAt.slice(11, 16) : null;
  const provChain = construirProvenance(chain.fonteDetalhe ?? chain.fonte ?? "cadeia", chain.dataEfetiva, {
    buscadoEm: chain.fetchedAt ?? chain.updatedAt,
    horaDoDado: horaTick,
    refSession: sess.ultimaSessao,
  });
  const provSpot = construirProvenance(
    viaMt5 ? `tick do papel · ${chain.fonteDetalhe ?? "MT5"}` : "histórico diário (fechamento)",
    chain.spotDate,
    { buscadoEm: chain.fetchedAt ?? chain.updatedAt, horaDoDado: horaTick, refSession: sess.ultimaSessao }
  );
  // Book: ao vivo pela ponte (tickAt) ou de fechamento (ofertasData); a contagem separa os dois.
  const comBook = chain.options.filter((o) => o.bid != null && o.ask != null);
  const bookAoVivo = comBook.filter((o) => o.tickAt).length;
  const bookFechamento = comBook.length - bookAoVivo;
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

      <Bloco label="SPOT" prov={provSpot} extra={horaTick ?? undefined} />
      <Bloco label="CHAIN" prov={provChain} extra={viaMt5 ? "MT5" : chain.fonte === "opcoes.net.br" ? "opcoes.net.br" : undefined} />
      {chain.stale && (
        <span className="whitespace-nowrap text-term-amber" title="A fonte falhou e a rota serviu a última grade boa guardada. Os números são de quando ela foi buscada.">
          STALE
        </span>
      )}
      {oiFileDate && <Bloco label="OI B3" prov={provOi} />}

      <span
        className="whitespace-nowrap text-term-dim"
        title={
          comBook.length === 0
            ? "Nenhuma série com bid e ask: sem ponte MT5 e sem arquivo de ofertas de fechamento da B3 para a data."
            : `${bookAoVivo} série(s) com book ao vivo (MT5)${bookFechamento ? ` e ${bookFechamento} com oferta de fechamento (COTAHIST)` : ""}. Séries com as duas ofertas e spread razoável são marcadas pelo mid.`
        }
      >
        BOOK{" "}
        <span className={comBook.length === 0 ? "text-term-dim" : bookAoVivo > 0 ? "text-term-green" : "text-term-cyan"}>
          {comBook.length}/{chain.options.length}
        </span>{" "}
        {bookAoVivo > 0 ? "ao vivo" : comBook.length > 0 ? "fechamento" : "sem oferta"}
      </span>

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
