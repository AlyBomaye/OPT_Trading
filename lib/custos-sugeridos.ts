/**
 * Custos sugeridos — com proveniência, para confirmar e editar.
 *
 * A plataforma NÃO inventa percentual. O que está aqui tem origem declarada e data. A tabela da
 * B3 é oficial e pública. 18/09/2026: o operador migrou as operações para a **Genial**; a tabela
 * oficial (genialinvestimentos.com.br/custos-tarifas, "última atualização 06/26") foi lida na
 * íntegra e é o padrão (`CUSTOS_SUGERIDOS_PADRAO`). A tabela da XP fica como referência histórica
 * — boletas antigas foram gravadas com ela e não mudam.
 *
 * Tudo aqui é sugestão: a tela pré-preenche, você confirma ou corrige, e cada boleta guarda o que
 * valeu na hora. Mudar a tabela depois não reescreve boleta antiga.
 */

export interface CustosSugeridos {
  /** Corretagem fixa por ordem, em R$. */
  corretagemFixa: number;
  /** B3 — taxa de negociação (emolumentos), fração do financeiro (prêmio × qtd), por lado. */
  emolumentosPct: number;
  /** B3 — taxa de liquidação, fração do financeiro, por lado. */
  liquidacaoPct: number;
  /** B3 — taxa de registro (só no mercado de opções), fração do financeiro, por lado. */
  registroPct: number;
  /** "Taxa operacional" sobre corretagem + taxas B3, em fração (XP cobra 5,9%; Genial não tem). */
  taxaOperacionalPct: number;
  /** ISS 5% + PIS 0,65% + COFINS 4% sobre a corretagem (a tabela é líquida; a nota cobra por cima). */
  impostosCorretagemPct: number;
  /** Exercer uma opção comprada: mínimo por série, em R$ (Genial: 0,50% + R$ 25,21, mínimo R$ 40; XP: mínimo R$ 100). */
  exercicioMinimoPorSerie: number;
  /** B3 — ações à vista (usado no exercício/atribuição e em pernas de ação), total, fração. */
  acoesAVistaPct: number;
  fonte: string;
  confirmar: true;
  observacoes: string[];
}

/**
 * Genial — tabela oficial de custos e tarifas, pessoa física, lida em 18/09/2026 ("última
 * atualização na tabela de custos realizada em 06/26"). O que vale para este perfil (swing trade
 * de opções, RLP ativo):
 *
 *   Swing trade, com RLP ativo:  opções compra/venda R$ 0,99 · ser exercido (atribuído) R$ 0,99 ·
 *                                ações lote padrão R$ 0,99 · fracionário R$ 0,99 · BDR R$ 0,99
 *   Swing trade, sem RLP:        opções R$ 2,49 · ser exercido R$ 2,99 · ações R$ 2,99
 *   Day trade, com RLP ativo:    ZERO em ações, BDR e opções (compra/venda e exercido)
 *   Day trade, sem RLP:          ações R$ 0,99 · opções R$ 2,49 · exercido R$ 2,99
 *   Exercer (mesa, qualquer caso): 0,50% do financeiro + R$ 25,21, mínimo R$ 40,00 por série
 *   Custódia: ZERO (fixa e variável) · ISS/PIS/COFINS 9,65% sobre a corretagem · sem taxa operacional
 *   B3 (emolumentos) por fora, como em qualquer corretora.
 *
 * RLP (Retail Liquidity Provider): a corretagem de R$ 0,99 e as plataformas a custo zero exigem
 * adesão e permanência no RLP. As "Regras Custo Zero" das plataformas (Profit e afins) exigem ainda
 * uma ordem real em WDO ou WIN por ciclo de renovação; o MetaTrader 5 não está na lista de
 * plataformas cobradas. Sobre ordens com validade > 1 dia pode haver taxa por dia com execução
 * parcial — mais um motivo para ordem com validade do dia.
 */
export const CUSTOS_SUGERIDOS_GENIAL_B3: CustosSugeridos = {
  corretagemFixa: 0.99,
  emolumentosPct: 0.00037,
  liquidacaoPct: 0.000275,
  registroPct: 0.000695,
  taxaOperacionalPct: 0,
  impostosCorretagemPct: 0.0965,
  exercicioMinimoPorSerie: 40,
  acoesAVistaPct: 0.0003,
  fonte:
    "Genial (oficial, genialinvestimentos.com.br/custos-tarifas, tabela atualizada em 06/26, lida em 18/09/2026): swing trade com RLP ativo — opções compra/venda R$ 0,99 por ordem, ser exercido R$ 0,99, ações R$ 0,99; sem RLP R$ 2,49 / R$ 2,99 / R$ 2,99; day trade com RLP ZERO; exercer 0,50% + R$ 25,21 com mínimo de R$ 40 por série; custódia zero; ISS/PIS/COFINS 9,65% sobre a corretagem; sem taxa operacional. " +
    "B3 (oficial, b3.com.br/tarifas, 02/09/2026): opções de ações PF — negociação 0,0370% + liquidação 0,0275% + registro 0,0695% = 0,1340% sobre o prêmio, por lado; ações à vista 0,0300%.",
  confirmar: true,
  observacoes: [
    "Genial: R$ 0,99 por ordem em opções vale com o RLP ATIVO (adesão e permanência); sem RLP a opção custa R$ 2,49 por ordem. Confira na conta se o RLP está ativo — a plataforma assume que sim.",
    "Genial: exercer uma opção comprada passa pela mesa: 0,50% do financeiro + R$ 25,21, mínimo R$ 40 por série. Ser exercido (atribuído) custa R$ 0,99. Fechar ou rolar antes do vencimento evita a mesa.",
    "Genial: day trade com RLP ativo tem corretagem ZERO em ações e opções — mas as taxas da B3 continuam, e o IR do day trade é 20% (a apuração da plataforma é de swing).",
    "Genial: sobre ordens com validade acima de 1 dia pode haver taxa por dia com execução parcial — use validade do dia.",
    "B3: os percentuais incluem PIS/COFINS e incidem sobre o prêmio × quantidade, para comprador e vendedor. A taxa de registro (0,0695%) existe só no mercado de opções.",
    "Plataformas a custo zero (Profit e afins) exigem RLP ativo e uma ordem real em WDO/WIN por ciclo; sem isso a Genial cobra a mensalidade da plataforma no mês seguinte. O MetaTrader 5 não está na lista de cobrança.",
  ],
};

/**
 * Genial — corretagem para EXERCER uma opção comprada (mesa): 0,50% do financeiro + R$ 25,21,
 * mínimo R$ 40 por série. O financeiro é strike × quantidade.
 */
export function corretagemExercicioGenial(financeiro: number): number {
  return Math.max(40, 0.005 * Math.abs(financeiro) + 25.21);
}

/** A tabela padrão da plataforma — a corretora onde o operador executa (Genial desde 18/09/2026). */
export const CUSTOS_SUGERIDOS_PADRAO = CUSTOS_SUGERIDOS_GENIAL_B3;

/** XP — referência histórica (o livro operou com esta tabela até 18/09/2026). */
export const CUSTOS_SUGERIDOS_XP_B3: CustosSugeridos = {
  corretagemFixa: 18.9,
  emolumentosPct: 0.00037,
  liquidacaoPct: 0.000275,
  registroPct: 0.000695,
  taxaOperacionalPct: 0.059,
  impostosCorretagemPct: 0.0965,
  exercicioMinimoPorSerie: 100,
  acoesAVistaPct: 0.0003,
  fonte:
    "XP (oficial, xpi.com.br/custos-operacionais, texto de 02/09/2026): swing trade via plataformas R$ 18,90 por ordem executada (sem assessor); corretagens líquidas de ISS 5% + PIS 0,65% + COFINS 4%; taxa operacional de 5,9% sobre corretagem + emolumentos + liquidação; exercício pela Tabela Bovespa com mínimo de R$ 100,00 por série. " +
    "B3 (oficial, b3.com.br/tarifas, 02/09/2026): opções de ações PF — negociação 0,0370% + liquidação 0,0275% + registro 0,0695% = 0,1340% sobre o prêmio, por lado; ações à vista 0,0300%.",
  confirmar: true,
  observacoes: [
    "XP: R$ 18,90 vale para quem opera por conta própria, sem vínculo com assessor; com assessor (mesa) é Tabela Bovespa com mínimo de R$ 40 por ordem.",
    "XP: a corretagem é cobrada por ordem executada, inteira mesmo em execução parcial; alterar uma ordem conta como ordem nova.",
    "XP: exercício custa Tabela Bovespa com MÍNIMO de R$ 100 por série — fechar ou rolar antes do vencimento evita esse piso. O painel de vencidas já propõe R$ 100 de corretagem no exercício.",
    "B3: os percentuais incluem PIS/COFINS e incidem sobre o prêmio × quantidade, para comprador e vendedor. A taxa de registro (0,0695%) existe só no mercado de opções.",
    "Sem day trade: as alíquotas de day trade (B3 e IR 20%) não se aplicam a este perfil.",
  ],
};
