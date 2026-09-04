/**
 * WO-46: Chain, Histórico e Watchlist deixaram de ser rotas. Os destinos passam a carregar
 * `?modo=` porque a Estratégia monta um modo por vez — âncora sem o modo certo aponta para
 * conteúdo não renderizado, e o link falha sem avisar.
 */
export const DEEP_LINKS = {
  "carteira.flags": "/portfolio#acao-do-dia",
  "carteira.baldes": "/portfolio#capital",
  "carteira.journal": "/portfolio#journal",
  "carteira.greeks": "/portfolio#greeks",
  "carteira.risk": "/portfolio#risk-profile",
  "chain.skew": "/estrategia?modo=cadeia#skew",
  "chain.termo": "/estrategia?modo=cadeia#estrutura-a-termo",
  "chain.smile": "/estrategia?modo=cadeia#smile",
  "chain.markQuality": "/estrategia?modo=cadeia#mark-quality",
  "cockpit.gex": "/#gex",
  "cockpit.shock": "/#choque-portfolio",
  "cockpit.focus": "/#foco-dia",
  "macro.juros": "/macro#curva-juros",
  "macro.sessoes": "/macro#sessoes-globais",
  "macro.impacto": "/macro#impacto-universo",
  "noticias.radar": "/noticias#radar-eventos",
  "noticias.setor": "/noticias#dashboard-setorial",
  "noticias.buzz": "/noticias#cobertura-acoes",
  "scanner.setor": "/scanner#alocacao-setor",
  "scanner.pozinhos": "/scanner#pozinhos-tabela",
  "estrategia.workbench": "/estrategia",
  "estrategia.payoff": "/estrategia#payoff",
  "historico.cone": "/estrategia?modo=contexto#cone",
  "historico.iv-vs-hv": "/estrategia?modo=contexto#iv-vs-hv",
  "watchlist.tabela": "/#watchlist-tabela",
  "consultor.gateway": "/consultor#gateway",
  "consultor.pipeline": "/consultor#pipeline",
} as const;

export type DeepLinkKey = keyof typeof DEEP_LINKS;

export function link(key: DeepLinkKey): string {
  return DEEP_LINKS[key];
}
