export const DEEP_LINKS = {
  "carteira.flags": "/carteira#acao-do-dia",
  "carteira.baldes": "/carteira#capital",
  "carteira.journal": "/carteira#journal",
  "carteira.greeks": "/carteira#greeks",
  "carteira.risk": "/carteira#risk-profile",
  "chain.skew": "/chain#skew",
  "chain.termo": "/chain#estrutura-a-termo",
  "chain.smile": "/chain#smile",
  "chain.markQuality": "/chain#mark-quality",
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
  "historico.cone": "/historico#cone",
  "historico.iv-vs-hv": "/historico#iv-vs-hv",
  "watchlist.tabela": "/watchlist#watchlist-tabela",
  "consultor.gateway": "/consultor#gateway",
  "consultor.pipeline": "/consultor#pipeline",
} as const;

export type DeepLinkKey = keyof typeof DEEP_LINKS;

export function link(key: DeepLinkKey): string {
  return DEEP_LINKS[key];
}
