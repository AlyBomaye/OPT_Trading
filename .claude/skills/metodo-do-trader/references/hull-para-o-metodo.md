# A teoria por trás do método — ligações, em palavras nossas

Síntese do que a literatura clássica de derivativos (Hull e afins) sustenta em cada decisão do
método. Serve para explicar ao trader, no Manual ou pelo Consultor, **por que** a regra existe —
não para substituí-la.

## Por que vender vol cara tem expectativa positiva

A IV costuma ficar acima da vol que o ativo depois realiza. Isso não é ineficiência: é o
prêmio que quem compra proteção paga por transferir o risco de cauda. Quem vende recebe esse
prêmio e assume a cauda. A expectativa é positiva **na média de muitas operações** e negativa
em algumas poucas — exatamente o que o método chama de lei dos grandes números, e o motivo do
limite de 1% (sobreviver às poucas).

Consequência prática: a régua correta é `IV − HV` **em relação ao histórico desse prêmio**, não
IV alta em termos absolutos. Uma IV de 40% pode ser barata para um ativo que realiza 45%.

## Por que a saída a 70% faz sentido (gamma × theta)

Numa venda de prêmio, o ganho vem do theta (o tempo corrói o valor da opção) e o risco vem do
gamma (o delta muda contra você quando o ativo anda). Os dois crescem juntos à medida que o
vencimento se aproxima e o ativo fica perto do strike: os últimos 30% do prêmio são justamente
os que exigem carregar o maior gamma pelo maior tempo relativo. Sair a 70% troca um pedaço
pequeno de theta futuro por uma redução grande de gamma. Em termos de expectativa por unidade
de risco, é a parte da curva com melhor razão.

O mesmo raciocínio explica a rolagem a 10 DU e a zeragem a 5 DU: abaixo de ~5 DU o valor-tempo
é pequeno e o gamma perto do dinheiro é enorme; a posição vira aposta no fechamento do dia do
vencimento, o que não é o negócio do método.

## O que a distribuição implícita diz sobre a Trava de Linha

O smile descendente das ações significa que a distribuição que o mercado usa para precificar
tem a cauda esquerda mais gorda que a lognormal: quedas grandes são mais prováveis (ou mais
temidas) do que o modelo assume. Para uma Trava de Linha vendida (straddle), isso quer dizer
que a perda grande, quando vem, tende a vir pela queda — e que a put da estrutura é a perna
que "cobra caro" com razão. Vender a Trava de Linha Larga com a put mais afastada que a call
(assimetria a favor do skew) é a tradução prática.

A PoP da plataforma usa a lognormal risco-neutra: ela **subestima** um pouco a probabilidade
de queda forte. Por isso o método não usa PoP como critério isolado e exige o limite de 1%.

## Por que estrutura, e não perna seca

Uma perna vendida seca tem perda ilimitada (call) ou muito grande (put). Toda a teoria de
hedging mostra que replicar a proteção dinamicamente (delta-hedge) custa theta e transações;
para um investidor com custo fixo por ordem, a forma barata de comprar a proteção é **a perna
comprada da própria estrutura**, paga uma vez. A trava é o hedge estático. Isso é o que o
método chama de "risco definido" e é o que permite a regra do 1% ser calculável antes de
Boletar.

## Por que dividendos importam num mercado de opções americanas

Na B3, opções sobre ações podem ser exercidas antes do vencimento. Para calls, isso só vale a
pena na véspera de um ex-date, quando o dividendo é maior que o valor-tempo que resta. Uma
call vendida ITM com JCP anunciado é atribuída na véspera e o lançador perde o dividendo (se
tem a ação) ou fica vendido na ação (se não tem). Daí a flag `EX_DIV` e a regra: com ex-date
antes do vencimento, decida antes da véspera.

## Por que o número precisa de data (proveniência)

Os desastres clássicos com derivativos têm em comum marcações que ninguém verificou e
modelos em que se confiou sem comparar com o mercado. Um investidor solo não tem área de
risco independente; a plataforma faz esse papel ao recusar números sem origem. `null` com
explicação vale mais que uma estimativa sem aviso — porque o trader decide dinheiro com o que
vê.

## Por que amostra grande

Com expectativa positiva pequena por operação (o prêmio de vol é de poucos pontos) e variância
alta (a cauda), a realização em 10 operações pode ser qualquer coisa. Só com centenas a média
observada converge para a esperada. O método aceita sequências de perda como custo do
negócio; a plataforma mostra a amostra ao lado da taxa de acerto para o trader não tirar
conclusão de ruído.
