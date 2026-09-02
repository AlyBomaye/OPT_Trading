import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { estadoLivro } from "@/lib/boletas";
import { apurarMeses, apurarOperacoes } from "@/lib/fiscal";
import { gerarXlsx, type Planilha } from "@/lib/xlsx-minimo";
import type { Position } from "@/lib/types";

/**
 * Exportação da Carteira em Excel — todas as operações, consolidadas.
 *
 * GET  → com o livro no banco: a fita inteira de boletas, estruturas, pernas abertas, saídas
 *        (base fiscal) e a apuração mensal de DARF, uma planilha por assunto.
 * POST → sem banco: recebe { positions, closed, capitalTotal } do navegador e exporta o que há.
 *
 * Números vão como números (não texto), datas como ISO. Sem dependência: `lib/xlsx-minimo.ts`.
 */

export const dynamic = "force-dynamic";

const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

function planilhasDePosicoes(abertas: Position[], fechadas: Position[], capital: number | null): Planilha[] {
  const pernas: Planilha = {
    nome: "Pernas abertas",
    cabecalho: ["Ativo", "Instrumento", "Tipo", "Strike", "Vencimento", "Lado", "Qtd", "Preço médio", "Custos acum.", "Aberta em", "Estrutura", "Tese", "Alvo", "Regra de saída", "Regime na entrada"],
    larguras: [9, 13, 7, 9, 12, 6, 7, 12, 12, 12, 10, 40, 9, 40, 16],
    linhas: abertas.map((p) => [
      p.underlying, p.kind === "STOCK" ? "ação" : p.opTicker ?? "", p.type ?? "", p.strike ?? null, dataBr(p.expiry),
      p.side === 1 ? "C" : "V", Math.abs(p.qty), p.price, p.fees ?? 0, dataBr(p.openedAt), p.estruturaId ?? "",
      p.tese ?? "", p.alvo ?? null, p.regraSaida ?? "", p.regimeNaEntrada ?? "",
    ]),
  };
  const ops = apurarOperacoes(fechadas);
  const saidas: Planilha = {
    nome: "Saídas (fiscal)",
    cabecalho: ["Competência", "Ativo", "Instrumento", "Natureza", "Tipo perna", "Lado", "Qtd", "Preço médio", "Preço saída", "Custos", "Resultado", "Valor venda", "Motivo", "Aberta em", "Fechada em"],
    larguras: [11, 9, 13, 9, 10, 6, 7, 12, 12, 10, 12, 12, 11, 12, 12],
    linhas: fechadas.map((p, i) => [
      ops[i]?.competencia ?? dataBr(p.closedAt).slice(0, 7), p.underlying, p.kind === "STOCK" ? "ação" : p.opTicker ?? "",
      ops[i]?.natureza ?? "", p.kind, p.side === 1 ? "C" : "V", Math.abs(p.qty), p.price, p.closePrice ?? null, p.fees ?? 0,
      ops[i]?.resultado ?? null, ops[i]?.valorVenda ?? null, p.motivoSaida ?? "", dataBr(p.openedAt), dataBr(p.closedAt),
    ]),
  };
  const meses = apurarMeses(ops);
  const darf: Planilha = {
    nome: "Apuração DARF",
    cabecalho: ["Competência", "Swing (R$)", "Ops swing", "Day (R$)", "Ops day", "Vendas ações swing", "Ações isentas", "Ganho ações isento", "Compensado swing", "Compensado day", "Base swing", "Base day", "IR swing 15%", "IR day 20%", "IRRF retido", "DARF", "Vencimento DARF", "Saldo prej. swing", "Saldo prej. day"],
    larguras: [11, 12, 9, 12, 8, 16, 12, 16, 15, 14, 12, 12, 12, 12, 11, 11, 15, 16, 15],
    linhas: meses.map((m) => [
      m.competencia, m.swing.resultado, m.swing.operacoes, m.day.resultado, m.day.operacoes, m.vendasAcoesSwing, m.acoesIsentas ? "sim" : "não", m.ganhoAcoesIsento,
      m.compensadoSwing, m.compensadoDay, m.baseSwing, m.baseDay, m.impostoSwing, m.impostoDay, m.irrfRetido, m.darf, m.vencimentoDarf, m.saldoPrejuizoSwing, m.saldoPrejuizoDay,
    ]),
  };
  const resumo: Planilha = {
    nome: "Resumo",
    cabecalho: ["Item", "Valor"],
    larguras: [34, 18],
    linhas: [
      ["Gerado em", new Date().toISOString()],
      ["Pernas abertas", abertas.length],
      ["Saídas registradas", fechadas.length],
      ["Capital / caixa (R$)", capital],
      ["Regra fiscal", "Opções: 15% sobre o ganho, sem isenção. Ações à vista: isentas se vendas do mês ≤ R$ 20 mil. IRRF 0,005% sobre a venda (swing). Apuração, não assessoria contábil."],
    ],
  };
  return [resumo, pernas, saidas, darf];
}

function planilhasDoLivro(estado: NonNullable<Awaited<ReturnType<typeof estadoLivro>>>): Planilha[] {
  const boletas: Planilha = {
    nome: "Boletas",
    cabecalho: ["ID", "Executada em", "Registrada em", "Tipo", "Origem", "Estrutura", "Perna", "Ativo", "Instrumento", "Tipo opção", "Strike", "Vencimento", "Lado", "Qtd", "Preço", "Financeiro", "Corretagem", "Emolumentos", "Liquidação", "Registro", "Taxa operacional", "Custos total", "Motivo saída", "Preço médio ref.", "Custo abertura ref.", "Estorna", "Nota"],
    larguras: [6, 20, 20, 11, 10, 9, 7, 8, 13, 9, 9, 12, 6, 7, 10, 12, 11, 12, 11, 10, 15, 12, 12, 14, 16, 8, 30],
    linhas: estado.boletas.map((b) => [
      b.id, b.executadoEm, b.criadoEm, b.tipo, b.origem, b.estruturaId ?? "", b.posicaoId ?? "", b.ticker, b.opTicker ?? (b.kind === "STOCK" ? "ação" : ""),
      b.tipoOpcao ?? "", b.strike ?? null, b.vencimento ?? "", b.lado == null ? "" : b.lado === 1 ? "C" : "V", b.quantidade, b.preco,
      b.lado == null ? null : b.preco * b.quantidade, b.corretagem, b.emolumentos, b.liquidacao, b.registro, b.taxaOperacional, b.custosTotal,
      b.motivoSaida ?? "", b.precoMedioRef ?? null, b.custosAberturaRef ?? null, b.estornaId ?? "", b.nota ?? "",
    ]),
  };
  const estruturas: Planilha = {
    nome: "Estruturas",
    cabecalho: ["ID", "Ativo", "Aberta em", "Fechada em", "Estrutura", "Tese", "Alvo", "Regra de saída", "Regime na entrada"],
    larguras: [6, 9, 20, 20, 22, 40, 9, 40, 16],
    linhas: estado.estruturas.map((e) => [e.id, e.ticker, e.abertaEm, e.fechadaEm ?? "", e.nomeDetectado ?? "", e.tese ?? "", e.alvo ?? null, e.regraSaida ?? "", e.regimeEntrada ?? ""]),
  };
  const caixa: Planilha = {
    nome: "Caixa",
    cabecalho: ["Item", "R$"],
    larguras: [26, 16],
    linhas: [
      ["Aportes", estado.caixa.aportes], ["Retiradas", estado.caixa.retiradas], ["Débitos (compras)", estado.caixa.debitos],
      ["Créditos (vendas)", estado.caixa.creditos], ["Custos", estado.caixa.custos], ["Saldo", estado.caixa.saldo],
    ],
  };
  const custos: Planilha = {
    nome: "Tabela de custos",
    cabecalho: ["Vigente desde", "Corretagem fixa", "Emolumentos (fração)", "Liquidação (fração)", "Registro (fração)", "Taxa operacional (fração)", "Fonte"],
    larguras: [13, 14, 18, 18, 16, 22, 60],
    linhas: estado.custos
      ? [[estado.custos.vigenteDesde, estado.custos.corretagemFixa, estado.custos.emolumentosPct, estado.custos.liquidacaoPct, estado.custos.registroPct, estado.custos.taxaOperacionalPct, estado.custos.fonte ?? ""]]
      : [["(não confirmada — a boleta usa a sugestão)", null, null, null, null, null, ""]],
  };
  return [...planilhasDePosicoes(estado.posicoes, estado.fechadas, estado.caixa.saldo), boletas, estruturas, caixa, custos];
}

function resposta(planilhas: Planilha[]): Response {
  const xlsx = gerarXlsx(planilhas);
  const nome = `carteira-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  if (!bancoConfigurado()) {
    return NextResponse.json({ error: "Sem banco: use o botão da Carteira, que envia o livro do navegador." }, { status: 409 });
  }
  const estado = await estadoLivro();
  if (!estado) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
  return resposta(planilhasDoLivro(estado));
}

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo || !Array.isArray(corpo.positions) || !Array.isArray(corpo.closed)) {
    return NextResponse.json({ error: "Envie positions, closed e capitalTotal." }, { status: 400 });
  }
  return resposta(planilhasDePosicoes(corpo.positions, corpo.closed, typeof corpo.capitalTotal === "number" ? corpo.capitalTotal : null));
}
