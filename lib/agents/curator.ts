import fs from "fs";
import path from "path";
import type { AgentReport, Achado, Afirmacao } from "./types";
import { link } from "./deeplinks";
import type { Position } from "../types";
import { alocacaoPorBalde } from "./risk";

function getMemDir(): string {
  return path.join(process.cwd(), "data", "agents");
}

function getCuradorDir(): string {
  return path.join(process.cwd(), "data", "agents", "curador-memoria");
}

function getPerformancePath(): string {
  return path.join(getCuradorDir(), "performance.jsonl");
}

function getAfirmacoesPath(agentId: string): string {
  return path.join(getMemDir(), agentId, "memory.json");
}

export function lerAfirmacoes(agentId: string): Afirmacao[] {
  try {
    const p = getAfirmacoesPath(agentId);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch {}
  return [];
}

export function salvarAfirmacoes(agentId: string, afirmacoes: Afirmacao[]): void {
  try {
    const dir = path.join(getMemDir(), agentId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getAfirmacoesPath(agentId), JSON.stringify(afirmacoes, null, 2), "utf-8");
  } catch (err) {
    console.error(`[curador-memoria] Erro ao salvar afirmações de ${agentId}:`, err);
  }
}

export function taxaDeAcerto(agentId: string): { n: number; taxa: number | null } {
  const afirmacoes = lerAfirmacoes(agentId);
  const verificadas = afirmacoes.filter((a) => a.resultado === "confirmado" || a.resultado === "refutado");
  if (verificadas.length === 0) {
    return { n: 0, taxa: null };
  }
  const confirmadas = verificadas.filter((a) => a.resultado === "confirmado").length;
  return {
    n: verificadas.length,
    taxa: Number((confirmadas / verificadas.length).toFixed(3)),
  };
}

export function verificarAfirmacoes(hoje: Date = new Date()): { verificadas: number; confirmadas: number; refutadas: number } {
  let verificadasCount = 0;
  let confirmadasCount = 0;
  let refutadasCount = 0;

  try {
    const dir = getMemDir();
    if (!fs.existsSync(dir)) return { verificadas: 0, confirmadas: 0, refutadas: 0 };

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const agentId = entry.name;
        const afirmacoes = lerAfirmacoes(agentId);
        let alterou = false;

        for (const af of afirmacoes) {
          if (af.resultado !== "pendente") continue;

          const dataCriacao = new Date(af.criadaEm);
          const diasDecorridos = Math.floor((hoje.getTime() - dataCriacao.getTime()) / (1000 * 60 * 60 * 24));

          if (diasDecorridos >= af.horizonteDias) {
            // Se possui valorNaEpoca e valorNoVencimento sintético ou verificado
            if (af.valorNaEpoca != null && af.valorNoVencimento != null) {
              if (af.direcaoEsperada === "sobe") {
                af.resultado = af.valorNoVencimento > af.valorNaEpoca ? "confirmado" : "refutado";
              } else if (af.direcaoEsperada === "cai") {
                af.resultado = af.valorNoVencimento < af.valorNaEpoca ? "confirmado" : "refutado";
              } else {
                af.resultado = "indeterminado";
              }
            } else {
              af.resultado = "indeterminado";
            }
            af.verificadaEm = hoje.toISOString();
            alterou = true;
            verificadasCount++;
            if (af.resultado === "confirmado") confirmadasCount++;
            if (af.resultado === "refutado") refutadasCount++;
          }
        }

        if (alterou) {
          salvarAfirmacoes(agentId, afirmacoes);
        }
      }
    }
  } catch (err) {
    console.error("[curador-memoria] Erro em verificarAfirmacoes:", err);
  }

  return { verificadas: verificadasCount, confirmadas: confirmadasCount, refutadas: refutadasCount };
}

export function consolidarMemoria(): { podados: number; deduplicados: number } {
  let podados = 0;
  let deduplicados = 0;

  try {
    const dir = getMemDir();
    if (!fs.existsSync(dir)) return { podados: 0, deduplicados: 0 };

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const agentId = entry.name;
        const afirmacoes = lerAfirmacoes(agentId);
        const agora = new Date();

        // 1. Deduplicação (mesmo agente, mesma métrica, mesma direção, mesmo horizonte)
        const dedupMap = new Map<string, Afirmacao>();
        for (const af of afirmacoes) {
          const key = `${af.metrica}|${af.direcaoEsperada}|${af.horizonteDias}`;
          if (!dedupMap.has(key)) {
            dedupMap.set(key, af);
          } else {
            deduplicados++;
          }
        }

        // 2. Poda de itens com mais de 180 dias
        const mantidas: Afirmacao[] = [];
        for (const af of Array.from(dedupMap.values())) {
          const dataCriacao = new Date(af.criadaEm);
          const dias = Math.floor((agora.getTime() - dataCriacao.getTime()) / (1000 * 60 * 60 * 24));
          if (dias > 180) {
            podados++;
          } else {
            mantidas.push(af);
          }
        }

        salvarAfirmacoes(agentId, mantidas);
      }
    }
  } catch (err) {
    console.error("[curador-memoria] Erro em consolidarMemoria:", err);
  }

  return { podados, deduplicados };
}

export interface DailyPerformanceRecord {
  data: string;
  capitalTotal: number;
  pnlAberto: number;
  pnlRealizadoAcum: number;
  equity: number;
  drawdown: number;
  baldes: { alto: number; medio: number; baixo: number };
  nPosicoes: number;
  deltaBook: number;
  thetaBook: number;
  varGrid: number;
}

export function gravarSnapshotPerformance(
  positions: Position[],
  capitalTotal: number,
  pnlRealizadoAcum: number,
  deltaBook: number,
  thetaBook: number,
  varGrid: number
): DailyPerformanceRecord {
  const dir = getCuradorDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const baldesInfo = alocacaoPorBalde(positions, capitalTotal);
  let pnlAberto = 0;
  for (const pos of positions) {
    if (pos.lastMark != null) {
      pnlAberto += pos.side * pos.qty * (pos.lastMark - pos.price);
    }
  }

  const equity = capitalTotal + pnlRealizadoAcum + pnlAberto;

  // Calcula drawdown baseado no histórico gravado em performance.jsonl
  let maxEquityHistorico = equity;
  try {
    const p = getPerformancePath();
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (rec.equity > maxEquityHistorico) maxEquityHistorico = rec.equity;
        } catch {}
      }
    }
  } catch {}

  const drawdown = maxEquityHistorico > 0 ? (equity - maxEquityHistorico) / maxEquityHistorico : 0;

  const rec: DailyPerformanceRecord = {
    data: new Date().toISOString().slice(0, 10),
    capitalTotal,
    pnlAberto: Number(pnlAberto.toFixed(2)),
    pnlRealizadoAcum: Number(pnlRealizadoAcum.toFixed(2)),
    equity: Number(equity.toFixed(2)),
    drawdown: Number(drawdown.toFixed(4)),
    baldes: {
      alto: baldesInfo.alto,
      medio: baldesInfo.medio,
      baixo: baldesInfo.baixo,
    },
    nPosicoes: positions.length,
    deltaBook: Number(deltaBook.toFixed(2)),
    thetaBook: Number(thetaBook.toFixed(2)),
    varGrid: Number(varGrid.toFixed(2)),
  };

  fs.appendFileSync(getPerformancePath(), JSON.stringify(rec) + "\n");
  return rec;
}

export function lerHistoricoPerformance(): DailyPerformanceRecord[] {
  try {
    const p = getPerformancePath();
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, "utf-8").split("\n").filter(Boolean);
      return lines.map((l) => JSON.parse(l));
    }
  } catch {}
  return [];
}

export function reportCurador(): AgentReport {
  const perfHist = lerHistoricoPerformance();
  const ultimoPerf = perfHist.length > 0 ? perfHist[perfHist.length - 1] : null;

  return {
    schemaVersion: 1,
    agentId: "curador-memoria",
    agentRole: "Cientista de dados e curador de memória",
    generatedAt: new Date().toISOString(),
    ticker: null,
    headline: ultimoPerf
      ? `Curadoria de memória ativa. Patrimônio total: R$ ${ultimoPerf.equity.toLocaleString("pt-BR")}, Drawdown: ${(ultimoPerf.drawdown * 100).toFixed(1)}%.`
      : "Curador de memória inicializado sem histórico prévio.",
    achados: [
      {
        id: "cur-mem-01",
        titulo: "Saúde da Memória e Acompanhamento de Performance",
        detalhe: ultimoPerf
          ? `O portfólio possui ${ultimoPerf.nPosicoes} posições abertas com alocação em baldes de risco ${ultimoPerf.baldes.alto}% ALTO / ${ultimoPerf.baldes.medio}% MÉDIO / ${ultimoPerf.baldes.baixo}% BAIXO.`
          : "Nenhum snapshot diário gravado ainda.",
        severidade: "info",
        evidencias: [
          {
            metrica: "Equity Atual",
            valor: ultimoPerf ? `R$ ${ultimoPerf.equity}` : null,
            fonte: "data/agents/curador-memoria/performance.jsonl",
            asOf: new Date().toISOString().slice(0, 10),
          },
        ],
        deepLink: link("carteira.flags"),
      },
    ],
    metricas: {
      nSnapshots: perfHist.length,
      equityAtual: ultimoPerf?.equity ?? null,
      drawdownAtual: ultimoPerf?.drawdown ?? null,
    },
    recomendacoes: [],
    melhorias: [],
    confianca: ultimoPerf ? "alta" : "baixa",
    limitacoes: ultimoPerf ? [] : ["Nenhum snapshot de performance gravado ainda."],
    dependencias: [],
  };
}
