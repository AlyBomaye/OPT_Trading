/** @type {import('next').NextConfig} */
const nextConfig = {
  // WO-57: dev (.next) e produção (.next-prod) em pastas separadas, para conviverem na mesma
  // máquina sem um corromper o build do outro. producao.ps1 exporta NEXT_DIST_DIR=.next-prod.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,

  /**
   * WO-46 — as abas Chain, Histórico e Watchlist deixaram de ser rotas.
   *
   * Redirecionar não é cortesia: os relatórios de agente já gravados carregam `deepLink` para
   * `/chain#skew` e `/historico#iv-vs-hv`, e o navegador do trader tem essas URLs no histórico.
   * Sem isto, um link salvo em setembro cai em 404 sem explicação.
   *
   * O `?modo=` importa tanto quanto o destino: a Estratégia só monta um modo por vez, então uma
   * âncora sem o modo certo apontaria para conteúdo não renderizado e o link morreria em silêncio
   * — que é pior do que o 404, porque ninguém percebe.
   *
   * Next.js preserva o fragmento (`#...`) automaticamente ao redirecionar; o que precisa ser
   * declarado é o modo.
   */
  async redirects() {
    return [
      { source: "/chain", destination: "/estrategia?modo=cadeia", permanent: true },
      { source: "/historico", destination: "/estrategia?modo=contexto", permanent: true },
      { source: "/watchlist", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
