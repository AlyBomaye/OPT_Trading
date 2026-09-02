/**
 * Custos sugeridos — com proveniência, para confirmar e editar.
 *
 * A plataforma NÃO inventa percentual. O que está aqui tem origem declarada e data. A tabela da
 * B3 é oficial e pública; a da XP eu não consegui abrir na fonte oficial em 02/09/2026 (a página de
 * custos devolveu 403 e a central de ajuda não renderiza sem sessão), então os valores da XP vêm de
 * terceiros que a citam e ficam marcados como **a confirmar contra a sua nota de corretagem**.
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
  /** XP — "taxa operacional" sobre corretagem + taxas B3, em fração. */
  taxaOperacionalPct: number;
  /** XP — ISS 5% + PIS 0,65% + COFINS 4% sobre a corretagem (a tabela é líquida; a nota cobra por cima). */
  impostosCorretagemPct: number;
  /** XP — exercício: Tabela Bovespa com mínimo por série de opção, em R$. */
  exercicioMinimoPorSerie: number;
  /** B3 — ações à vista (usado no exercício/atribuição e em pernas de ação), total, fração. */
  acoesAVistaPct: number;
  fonte: string;
  confirmar: true;
  observacoes: string[];
}

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
