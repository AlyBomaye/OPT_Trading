"use client";

import { useEffect, useMemo } from "react";
import { useMarket } from "@/store/market";
import { caixaLivre } from "@/lib/portfolio";
import { CUSTOS_SUGERIDOS_XP_B3 } from "@/lib/custos-sugeridos";
import type { TabelaCustos } from "@/lib/boleta-calculos";

/**
 * WO-49 §B — o livro (Postgres) e o que dele deriva, para qualquer aba.
 *
 * Antes, só a Carteira sincronizava o livro; Estratégia e Scanner calculavam o caixa livre como
 * `capitalTotal − alocado`, um número diferente do da Carteira na mesma sessão. Agora as três
 * abas leem o mesmo `caixaLivre` e a mesma tabela de custos (a vigente, ou a sugestão oficial
 * rotulada como sugestão — nunca um percentual inventado).
 *
 * A sincronização acontece uma vez por montagem da aba; a Carteira continua ressincronizando
 * depois de cada boleta.
 */
export function useLivro() {
  const livro = useMarket((st) => st.livro);
  const sincronizarLivro = useMarket((st) => st.sincronizarLivro);
  const positions = useMarket((st) => st.positions);
  const capitalTotal = useMarket((st) => st.capitalTotal);

  useEffect(() => {
    if (!livro.consultadoEm) void sincronizarLivro();
    // Só na montagem: `consultadoEm` muda depois da própria sincronização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabelaCustos: TabelaCustos = useMemo(
    () => livro.custos ?? { ...CUSTOS_SUGERIDOS_XP_B3, vigenteDesde: "sugestao" },
    [livro.custos]
  );

  const caixa = useMemo(() => caixaLivre({ capitalTotal, positions, livro }), [capitalTotal, positions, livro]);

  return { livro, tabelaCustos, caixaLivre: caixa, livroAtivo: caixa.livroAtivo };
}
