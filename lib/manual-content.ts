/**
 * WO-15: Conteúdo estático do Módulo Manual (/manual, hotkey 9).
 * Guia de uso, Mapa de informações ("onde encontro o quê") e Glossário de verbetes do trader.
 * Todos os valores numéricos, limiares e fórmulas refletem 100% o código-fonte do terminal.
 */

export interface Termo {
  termo: string;
  definicao: string;
  ondeAparece: string;
}

export interface LinhaMapa {
  informacao: string;
  onde: string;
  painel: string;
}

export interface Secao {
  id: string;
  title: string;
}

export const SECTIONS: Secao[] = [
  { id: "guia-rotina", title: "1. Rotina Pré-Market em 5 Passos" },
  { id: "guia-workbench", title: "2. Como Montar Operações no Workbench" },
  { id: "guia-telas", title: "3. O que cada tela responde" },
  { id: "guia-hotkeys", title: "4. Atalhos de Teclado" },
  { id: "guia-dados", title: "5. Proveniência, Dados e Limitações" },
  { id: "mapa-info", title: "Mapa de Informações (Onde Encontro X)" },
  { id: "glossario", title: "Glossário do Trader de Opções" },
];

export const ROTINA_PRE_MARKET = [
  {
    passo: "1. Notícias & Macro (Hotkey 6)",
    detalhe: "Consulte o calendário macroeconômico e o feed de notícias para identificar decisões de juros (Copom/Fed), divulgação de inflação (IPCA/CPI) e payroll que possam disparar surtos de volatilidade.",
  },
  {
    passo: "2. Watchlist & Skew (Hotkey 8)",
    detalhe: "Varra os tickers da B3 em busca de distorções de Skew Ratio (IV Put ÷ IV Call) e assimetrias de volatilidade entre ativos para escolher os melhores papéis da sessão.",
  },
  {
    passo: "3. Histórico de Volatilidade (Hotkey 7)",
    detalhe: "Avalie se a volatilidade atual do ativo está esticada ou barata checando o spread IV−HV21, o Cone de Volatilidade e o IV Rank (percentil contra o histórico próprio).",
  },
  {
    passo: "4. Cockpit Matinal (Hotkey 1)",
    detalhe: "Examine o diagnóstico do seu book: choque de portfólio (Δ/Γ/Vega/Θ), VaR 95% 1d, níveis manuais de GEX (Gamma Flip e Walls), top pozinhos do dia e a sugestão automática do Foco do Dia.",
  },
  {
    passo: "5. Workbench de Estratégia (Hotkey 3)",
    detalhe: "Selecione a estrutura ideal no Workbench, ajuste as pernas e prêmios, valide breakevens, PoP e matriz Spot×Vol, dimensione a mão via ¼-Kelly e registre na Carteira.",
  },
];

export const PASSO_A_PASSO_WORKBENCH = [
  "No Workbench (Hotkey 3), selecione o vencimento desejado no MiniChain situado no painel esquerdo.",
  "Para montar uma Trava de Alta com Calls (Bull Call Spread): clique no botão C (Call) da opção ATM desejada para comprar (+1) e no botão V (Call) de um strike superior OTM para vender (-1).",
  "Confirme se o nome da estrutura detectada automaticamente no topo é 'Trava de Alta (calls)'.",
  "Observe o mapa de strikes: setas ▲/▼ indicam direcionalidade, a zona verde destaca o intervalo de lucro e as linhas verticais mostram os breakevens.",
  "Ajuste quantidade de contratos, prêmios unitários ou vol offset (pontos de vol) no editor de pernas, se necessário.",
  "Valide o custo de montagem (débito), lucro máximo, perda máxima, probabilidade de lucro (PoP risco-neutra) e as gregas líquidas resultantes.",
  "Consulte o dimensionamento sugerido pelo ¼-Kelly e o limite de orçamento sobre o capital total.",
  "Analise o comportamento do P&L no gráfico de Payoff comparando as curvas de Expiração e T+0 / T+n (reavaliação BSM) e inspecione a matriz de estresse Spot × Vol.",
  "Clique no botão 'Abrir posição na Carteira' para salvar a operação no seu livro com as gregas congeladas no momento da entrada.",
];

export const RESUMO_TELAS = [
  {
    modulo: "1. Cockpit Matinal",
    pergunta: "Qual o diagnóstico geral de risco do meu book e as melhores oportunidades do dia?",
    resposta: "Consolida choque de portfólio, VaR 95%, mapa de exposição a Gamma (GEX Flip/Walls), topo do scanner de pozinhos e o Foco do dia combinando regime × skew × book.",
  },
  {
    modulo: "2. Chain de Opções",
    pergunta: "Como as opções de todos os vencimentos estão precificadas na B3 agora?",
    resposta: "Exibe a grade completa Call|Strike|Put com IV recalculada por Newton-Raphson, gregas analíticas, negócios/volume, ITM sombreado, smile de vol e estrutura a termo.",
  },
  {
    modulo: "3. Estratégia (Workbench)",
    pergunta: "Como montar, simular e dimensionar operações de múltiplas pernas?",
    resposta: "Disponibiliza 13 presets da B3, editor multi-perna com prêmio/vol offset, gráfico de payoff Expiração·T+0·T+n, breakevens exatos, PoP risco-neutra, ¼-Kelly e matriz What-If.",
  },
  {
    modulo: "4. Scanner de Pozinhos",
    pergunta: "Onde estão as opções OTM baratas com maior assimetria de convexidade?",
    resposta: "Varre opções OTM com prêmio R$ 0,01–0,10, ordenando por convexidade (Δ/R$), distância em desvios padrões (σ) e percentual até o breakeven.",
  },
  {
    modulo: "5. Carteira & Journal",
    pergunta: "Qual a exposição agregada da minha carteira e o histórico de performance?",
    resposta: "Gerencia posições mantidas no navegador, P&L aberto/realizado, gregas líquidas reavaliadas pelo chain ao vivo, estresse de spot, VaR 95% 1d e curva de patrimônio.",
  },
  {
    modulo: "6. Notícias & Macro",
    pergunta: "Quais eventos macroeconômicos podem impactar a volatilidade hoje?",
    resposta: "Agrega notícias em tempo real via RSS e apresenta o calendário de eventos econômicos (Copom, Fed, IPCA, Payroll e Vencimentos de Opções B3).",
  },
  {
    modulo: "7. Histórico & Volatilidade",
    pergunta: "A volatilidade do ativo objeto está esticada ou barata graficamente?",
    resposta: "Apresenta gráfico de preços com bandas de volatilidade histórica (HV10, HV21, HV63), estimador de Parkinson, Cone de Volatilidade e spread IV−HV21.",
  },
  {
    modulo: "8. Watchlist & Skew Ratio",
    pergunta: "Quais ativos apresentam as maiores distorções de Skew Ratio no momento?",
    resposta: "Monitora múltiplos ativos da B3 calculando o Skew Ratio (IV Put ATM ÷ IV Call ATM) ponderado por volume financeiro e destaca desalinhamentos de volatilidade.",
  },
];

export const HOTKEYS_MANUAL = [
  { atalho: "1", descricao: "Navega para a Carteira & Journal" },
  { atalho: "2", descricao: "Navega para Macro Global & Rates" },
  { atalho: "3", descricao: "Navega para Notícias & Central de Contexto" },
  { atalho: "4", descricao: "Navega para o Scanner de Pozinhos" },
  { atalho: "5", descricao: "Navega para a Watchlist & Skew" },
  { atalho: "6", descricao: "Navega para o Workbench de Estratégias" },
  { atalho: "7", descricao: "Navega para o Cockpit Matinal" },
  { atalho: "8", descricao: "Navega para o Chain de Opções" },
  { atalho: "9", descricao: "Navega para Histórico & Volatilidade" },
  { atalho: "0", descricao: "Navega para o Manual da Plataforma" },
  { atalho: "R", descricao: "Força o refresh instantâneo do Chain de Opções (ignora cache de 60s)" },
  { atalho: "?", descricao: "Abre / fecha o modal overlay de ajuda com os atalhos de teclado" },
  { atalho: "Esc", descricao: "Fecha modais ou overlays abertos na tela" },
];

export const DADOS_LIMITACOES = [
  {
    titulo: "Fonte Anônima de Dados & Delay",
    texto: "As cotações da B3 são obtidas via proxy server-side do opcoes.net.br. Os dados refletem o último negócio (last-trade) com atraso de minutos e não possuem livro de ofertas (bid/ask) nem contratos em aberto (Open Interest).",
  },
  {
    titulo: "Recálculo Local de IV (Sem Volblur)",
    texto: "Como fontes públicas aplicam volblur (borram a volatilidade implícita), nosso engine quantitativo recalcula a IV via Newton-Raphson (com fallback para Bisseção em modelo BSM/CRR) a partir do prêmio real negociado, derivando todas as gregas analíticas.",
  },
  {
    titulo: "Chips de Proveniência",
    texto: "Para transparência total, o terminal exibe chips visuais de qualidade do dado: MANUAL (informado pelo usuário), STALE (cotação defasada ou sem negócios na sessão, riscada e excluída de smiles/scanners) e EST (estimado por modelo).",
  },
  {
    titulo: "Níveis Manuais de GEX",
    texto: "Os níveis de Gamma Exposure (GEX Flip, Call Wall, Put Wall, Vol Trigger) são preenchidos manualmente na aba Vol Map do Cockpit, permitindo acompanhar o regime de mercado sem depender de APIs proprietárias pagas.",
  },
  {
    titulo: "Aviso Legal & Educacional",
    texto: "Esta ferramenta é estritamente educacional e de apoio à decisão quantitativa. Não constitui recomendação de investimento ou oferta de compra/venda de ativos. Valide todas as operações antes de executar no home broker.",
  },
];

export const MAPA_INFORMACOES: LinhaMapa[] = [
  { informacao: "Spot e IV ATM do ativo selecionado", onde: "TickerBar no topo", painel: "Barra superior permanente em todas as telas" },
  { informacao: "Skew Ratio e sinal (Puts/Calls caras)", onde: "TickerBar / Cockpit / Watchlist", painel: "Card 2 do Cockpit, chip da TickerBar e tabela da Watchlist" },
  { informacao: "IV Rank (percentil histórico da IV)", onde: "TickerBar / Histórico", painel: "Chip na TickerBar e painel de estatísticas no Histórico (requer ≥ 20 snapshots)" },
  { informacao: "Volatilidade realizada (HV21, HV63, Parkinson)", onde: "Histórico", painel: "Painel de estatísticas de retornos e gráfico de séries temporais" },
  { informacao: "Cone de Volatilidade (min, p25, med, p75, max)", onde: "Histórico", painel: "Tabela de distribuição do Cone de Volatilidade" },
  { informacao: "Estrutura a Termo da Volatilidade", onde: "Chain de Opções", painel: "Aba 'Estrutura a Termo' no topo do Chain" },
  { informacao: "Smile de Volatilidade por Strike", onde: "Chain de Opções", painel: "Aba 'Vol Smile' no topo do Chain" },
  { informacao: "Pozinhos (opções OTM de alta convexidade)", onde: "Scanner / Cockpit", painel: "Tabela do Scanner de Pozinhos e Card 3 do Cockpit Matinal" },
  { informacao: "Gregas líquidas do book (Δ, Γ, Vega, Θ)", onde: "Cockpit / Carteira", painel: "Card 1 do Cockpit e painel 'Net Greeks' na Carteira" },
  { informacao: "Gregas da estrutura em montagem", onde: "Estratégia (Workbench)", painel: "Painel de pernas e gregas combinadas à direita" },
  { informacao: "VaR 95% 1d, Expected Shortfall (ES) e Estresse", onde: "Carteira / Cockpit", painel: "Painel 'Risco & VaR 95%' na Carteira e Card 1 do Cockpit" },
  { informacao: "Capital alocado, disponível e dimensionamento ¼-Kelly", onde: "Carteira / Estratégia", painel: "Resumo financeiro na Carteira e sugestão de Kelly no Workbench" },
  { informacao: "Win Rate, Payoff Ratio e Curva de Patrimônio", onde: "Carteira", painel: "Painel 'Journal & Estatísticas' e gráfico de Curva de Equity" },
  { informacao: "Proventos (dividendos/JCP) e ex-dates", onde: "TickerBar / Chain", painel: "Engrenagem da TickerBar e chips 'DIV' nas opções do Chain" },
  { informacao: "Alerta de risco de exercício antecipado (Americanas)", onde: "Carteira", painel: "Alerta visual destacado em posições ITM na Carteira" },
  { informacao: "Agenda econômica e notícias de mercado", onde: "Notícias & Macro", painel: "Painéis de Feed de Notícias e Calendário Macroeconômico" },
  { informacao: "Reavaliação a mercado de posições do book", onde: "Carteira", painel: "Botão 'Reavaliar tudo' no painel de posições da Carteira" },
  { informacao: "Breakevens exatos da operação", onde: "Estratégia (Workbench)", painel: "Resumo de métricas no cabeçalho do Workbench" },
  { informacao: "Probabilidade de Lucro (PoP risco-neutra)", onde: "Estratégia (Workbench)", painel: "Resumo de métricas no cabeçalho do Workbench" },
  { informacao: "Distribuição Lognormal de probabilidades do spot", onde: "Estratégia (Workbench)", painel: "Gráfico de densidade Lognormal no Workbench" },
  { informacao: "Matriz What-If de cenários (Spot × Vol × Tempo)", onde: "Estratégia (Workbench)", painel: "Painel 'Matriz de Sensibilidade' no Workbench" },
  { informacao: "Sugestão automática de estrutura pelo Skew", onde: "Cockpit / Estratégia", painel: "Card 'Foco do Dia' no Cockpit e botão 'Sugestão' no Workbench" },
  { informacao: "Qualidade da marcação da opção (fresh / ok / stale)", onde: "Chain / Scanner", painel: "Estilo riscado nas opções 'stale' (excluídas automaticamente de scanners)" },
];

export const GLOSSARIO: Termo[] = [
  {
    termo: "Δ Delta",
    definicao: "Exposição direcional da opção em ações equivalentes. Indica quanto o preço da opção varia em R$ para cada R$ 1,00 de movimentação no ativo objeto. O Delta Cash é calculado por Δ × Spot.",
    ondeAparece: "Chain, Workbench, Cockpit, Carteira",
  },
  {
    termo: "Γ Gamma",
    definicao: "Taxa de variação do Delta para cada R$ 1,00 de deslocamento no preço do ativo objeto (∂Δ/∂S). Mede a aceleração da exposição direcional e o risco de movimentos bruscos.",
    ondeAparece: "Chain, Workbench, Cockpit, Carteira",
  },
  {
    termo: "ν Vega",
    definicao: "Sensibilidade do preço da opção a mudanças na volatilidade implícita. No terminal, é expresso em variação financeira (R$) por incremento de +1 ponto percentual (+1%) na vol (÷100).",
    ondeAparece: "Chain, Workbench, Cockpit, Carteira",
  },
  {
    termo: "Θ Theta",
    definicao: "Taxa de depreciação temporal do valor da opção. Expresso no terminal em variação financeira (R$) perdida por dia corrido (÷365). Opções compradas possuem Theta negativo.",
    ondeAparece: "Chain, Workbench, Cockpit, Carteira",
  },
  {
    termo: "Rho (ρ)",
    definicao: "Sensibilidade do preço da opção em relação a variações de +1 ponto percentual (+1%) na taxa de juros livre de risco Selic (÷100).",
    ondeAparece: "Engine Black-Scholes",
  },
  {
    termo: "ATM / ITM / OTM",
    definicao: "Moneyness da opção. ATM (At-the-Money): strike próximo ao spot. ITM (In-the-Money): possui valor intrínseco. OTM (Out-of-the-Money): possui apenas valor extrínseco.",
    ondeAparece: "Chain, Scanner, Workbench",
  },
  {
    termo: "Backwardation / Contango",
    definicao: "Formato da estrutura a termo da volatilidade implícita. Contango: IV de vencimentos curtos menor que vencimentos longos. Backwardation: IV de vencimentos curtos maior que longos (sinal de estresse de mercado).",
    ondeAparece: "Chain (Aba Estrutura a Termo)",
  },
  {
    termo: "Breakeven (BE)",
    definicao: "Preço(s) do ativo objeto na data de expiração no(s) qual(ais) a operação zera o resultado (P&L = 0). Calculado no Workbench via resolução numérica de raízes.",
    ondeAparece: "Workbench de Estratégia, Scanner",
  },
  {
    termo: "Convexidade (|Δ|/Prêmio)",
    definicao: "Métrica de eficiência direcional do Scanner de Pozinhos. Mede quanta exposição de Delta a opção entrega por real aplicado (|Δ| ÷ prêmio), ranqueando opções OTM de alto potencial.",
    ondeAparece: "Scanner de Pozinhos, Cockpit (Card 3)",
  },
  {
    termo: "Cone de Volatilidade",
    definicao: "Distribuição histórica quantílica (mínimo, p25, mediana, p75, máximo) das volatilidades realizadas em janelas móveis (10, 21, 42 e 63 dias) para avaliar se a vol atual está extrema.",
    ondeAparece: "Histórico & Volatilidade",
  },
  {
    termo: "DU (Dias Úteis)",
    definicao: "Contagem de dias úteis até o vencimento da opção. O tempo até a expiração no modelo Black-Scholes do terminal utiliza a convenção fixa B3: t = DU / 252.",
    ondeAparece: "Chain, Scanner, Workbench",
  },
  {
    termo: "Ex-date / Escrow de Proventos",
    definicao: "Data a partir da qual a ação é negociada sem direito ao provento. O terminal ajusta o spot no pricing de opções: S′ = S − Σ PV(divs antes do vencimento), precificando sem distorção por proventos.",
    ondeAparece: "Chain, Editor de Proventos, Engine",
  },
  {
    termo: "Expected Move (Movimento Esperado)",
    definicao: "Amplitude de variação esperada para o preço do ativo objeto até a expiração dentro de 1 desvio padrão (1σ), calculada por: S · σ · √(DU / 252).",
    ondeAparece: "Cockpit Matinal, Chain",
  },
  {
    termo: "GEX / Gamma Flip / Call Wall / Put Wall / Vol Trigger",
    definicao: "Métricas de Gamma Exposure do mercado. Preenchidos manualmente no Cockpit: Gamma Flip (linha de transição de regime de vol), Call Wall (resistência de gamma), Put Wall (suporte) e Vol Trigger.",
    ondeAparece: "Cockpit Matinal (Aba Vol Map)",
  },
  {
    termo: "HV (Volatilidade Histórica) & Parkinson",
    definicao: "Medida da variação realizada dos retornos diários do ativo (close-to-close, anualizada por ×√252). O estimador de Parkinson utiliza a amplitude intra-diária (High e Low).",
    ondeAparece: "Histórico & Volatilidade, Watchlist",
  },
  {
    termo: "IV (Volatilidade Implícita)",
    definicao: "Volatilidade futura embutida no prêmio negociado. Recalculada no terminal via solver Newton-Raphson (modelo BSM europeu) e árvore binomial CRR (americano) a partir do preço real da opção.",
    ondeAparece: "Chain, Workbench, Scanner, Watchlist",
  },
  {
    termo: "IV Rank",
    definicao: "Percentil da IV ATM atual em relação ao histórico próprio de snapshots diários do ativo (exige no mínimo 20 observações armazenadas para exibição).",
    ondeAparece: "TickerBar, Histórico",
  },
  {
    termo: "IV−HV21",
    definicao: "Diferença entre a Volatilidade Implícita ATM e a Volatilidade Histórica de 21 dias. Destaque dourado indica vol rica (IV > HV21); destaque verde indica vol barata (IV < HV21).",
    ondeAparece: "Histórico, Watchlist, Cockpit",
  },
  {
    termo: "Kelly (f*) & ¼-Kelly",
    definicao: "Fórmula de otimização de capital: f* = (b·p − (1−p)) / b, onde p é a taxa de acerto e b o payoff ratio. O terminal sugere o ¼-Kelly (alocação fracionária defensiva) e exibe 'NO EDGE — DO NOT TRADE' se f* ≤ 0 (com ≥ 20 trades).",
    ondeAparece: "Workbench de Estratégia, Carteira (Journal)",
  },
  {
    termo: "markQuality (fresh / ok / stale)",
    definicao: "Qualidade da cotação. 'stale' indica preço suspeito (ex.: last < intrínseco ou 0 negócios no dia). Cotações stale são exibidas riscadas e excluídas de smiles, skews e scanners.",
    ondeAparece: "Chain, Scanner, Watchlist",
  },
  {
    termo: "Margem Estimada",
    definicao: "Capital de garantia estimado retido pela corretora em vendas cobertas/descobertas. No terminal, calculada como 20% × Strike × Quantidade para opções vendidas.",
    ondeAparece: "Carteira, Workbench",
  },
  {
    termo: "Payoff Ratio (b)",
    definicao: "Razão entre o ganho médio das operações lucrativas e a perda média absoluta das operações perdedoras (Média Ganhos ÷ |Média Perdas|). Utilizado no cálculo da fração de Kelly.",
    ondeAparece: "Carteira (Journal)",
  },
  {
    termo: "PoP (Probability of Profit)",
    definicao: "Probabilidade risco-neutra da estrutura encerrar no lucro na expiração, calculada pela integração da densidade de probabilidade lognormal com a IV ATM do vencimento.",
    ondeAparece: "Workbench de Estratégia",
  },
  {
    termo: "Pozinho",
    definicao: "Opção OTM de valor nominal reduzido (prêmio entre R$ 0,01 e R$ 0,10), distância de 10% a 35% do spot, volume financeiro ≥ R$ 2.000 e prazo entre 3 e 60 DU.",
    ondeAparece: "Scanner de Pozinhos, Cockpit",
  },
  {
    termo: "Skew Ratio",
    definicao: "Razão entre a IV ATM das Puts e a IV ATM das Calls (IV Put ATM ÷ IV Call ATM) ponderada por volume na banda ±5% do spot. ≥ 1,25 indica Puts caras; ≤ 0,90 indica Calls caras.",
    ondeAparece: "Watchlist, TickerBar, Cockpit, Scanner",
  },
  {
    termo: "STALE",
    definicao: "Chip visual de alerta para cotações antigas ou sem liquidez recente, acompanhado da idade da marcação em minutos (ex.: STALE 45m).",
    ondeAparece: "Chain, TickerBar, Watchlist",
  },
  {
    termo: "Straddle / Strangle",
    definicao: "Estruturas de volatilidade compondo compra/venda simultânea de Call e Put de mesmo vencimento. Straddle utiliza o mesmo strike; Strangle utiliza strikes OTM distintos.",
    ondeAparece: "Workbench de Estratégia",
  },
  {
    termo: "Trava de Alta / Baixa",
    definicao: "Estruturas verticais com a compra de uma opção e venda de outra do mesmo tipo com strike diferente no mesmo vencimento. Podem ser montadas a débito ou a crédito.",
    ondeAparece: "Workbench de Estratégia",
  },
  {
    termo: "Ratio Backspread",
    definicao: "Estrutura assimétrica vendendo 1 opção ITM/ATM cara e comprando 2 (ou mais) opções OTM baratas. Beneficia-se de explosão de volatilidade e movimentos fortes.",
    ondeAparece: "Workbench de Estratégia, Sugestor do Skew",
  },
  {
    termo: "Iron Condor / Butterfly",
    definicao: "Estruturas operacionais de rentabilização de intervalo (neutras). Borboleta combina 4 pernas com miolo duplo; Iron Condor combina 2 Calls OTM + 2 Puts OTM.",
    ondeAparece: "Workbench de Estratégia",
  },
  {
    termo: "Calendário / Diagonal",
    definicao: "Estruturas horizontais/diagonais explorando a passagem do tempo e o diferencial de IV entre vencimentos curtos e longos (venda do curto + compra do longo).",
    ondeAparece: "Workbench de Estratégia",
  },
  {
    termo: "Lançamento Coberto (Covered Call)",
    definicao: "Estrutura defensiva composta pela compra da ação e venda de Call OTM/ATM para geração de renda com o prêmio da opção.",
    ondeAparece: "Workbench de Estratégia",
  },
  {
    termo: "Put Protetora (Protective Put)",
    definicao: "Estrutura de proteção (hedge) compondo a compra da ação combinada com a compra de uma Put OTM como seguro contra quedas severas.",
    ondeAparece: "Workbench de Estratégia",
  },
  {
    termo: "Risk Reversal / Collar",
    definicao: "Estrutura compondo a compra de opção de um lado e venda financiada do outro (ex.: compra de Put OTM financiada pela venda de Call OTM para proteção de custódia).",
    ondeAparece: "Workbench de Estratégia",
  },
  {
    termo: "VaR 95% 1d & Expected Shortfall (ES)",
    definicao: "Value at Risk a 95% em 1 dia por reavaliação em grade 3×3: spot {−1.645σ, 0, +1.645σ} × vol {−20%, 0, +30%} com carrego Theta (T+1). ES é a média dos 2 piores cenários.",
    ondeAparece: "Carteira, Cockpit Matinal",
  },
  {
    termo: "Vencimento Mensal B3",
    definicao: "Data oficial de expiração das opções mensais na B3, que ocorre na 3ª sexta-feira de cada mês (ex.: 20/03/2026).",
    ondeAparece: "Chain, Notícias & Macro",
  },
  {
    termo: "Volatilidade Implícita vs. Realizada",
    definicao: "Comparação entre a volatilidade futura precificada pelas opções (IV) e a variação histórica efetiva do preço da ação (HV). IV > HV indica vol cara; IV < HV indica vol barata.",
    ondeAparece: "Histórico, Watchlist, Workbench",
  },
];
