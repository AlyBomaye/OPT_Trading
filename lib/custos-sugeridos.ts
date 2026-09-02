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
  /** B3 — ações à vista (usado no exercício/atribuição e em pernas de ação), total, fração. */
  acoesAVistaPct: number;
  fonte: string;
  confirmar: true;
  observacoes: string[];
}

export const CUSTOS_SUGERIDOS_XP_B3: CustosSugeridos = {
  corretagemFixa: 10.0,
  emolumentosPct: 0.00037,
  liquidacaoPct: 0.000275,
  registroPct: 0.000695,
  taxaOperacionalPct: 0.059,
  acoesAVistaPct: 0.0003,
  fonte:
    "B3 (oficial): opções de ações PF — negociação 0,0370% + liquidação 0,0275% + registro 0,0695% = 0,1340% sobre o prêmio, por lado; ações à vista 0,0300% (b3.com.br/tarifas, lido em 02/09/2026). " +
    "XP (terceiros, a confirmar): corretagem de opções R$ 10,00 por ordem/contrato (mobills 05/2023; nordinvestimentos 02/2025) e taxa operacional de 5,9% sobre corretagem + taxas (nordinvestimentos 02/2025). Página oficial xpi.com.br/custos-operacionais não acessível em 02/09/2026.",
  confirmar: true,
  observacoes: [
    "B3: os percentuais incluem PIS/COFINS e incidem sobre o prêmio × quantidade, para comprador e vendedor.",
    "Exercício/atribuição: a B3 cobra pela tabela de ações à vista sobre strike × quantidade; a XP pode cobrar corretagem de exercício própria — confira na nota.",
    "XP: fontes de terceiros divergem (R$ 10,00 por contrato vs. tabelas promocionais); a sua nota de corretagem é a verdade. Ajuste a corretagem fixa ao que ela mostrar.",
    "Sem day trade: as alíquotas de day trade (B3 e IR 20%) não se aplicam a este perfil.",
  ],
};
