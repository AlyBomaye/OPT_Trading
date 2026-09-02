"use client";

/**
 * WO-48 §5 — vencidas sem tratamento.
 *
 * Toda perna de opção aberta com vencimento no passado entra aqui com uma PROPOSTA calculada pelo
 * fechamento do ativo na data (de /api/history): OTM → virou pó; ITM comprada → exercício (compra
 * ou venda da ação a strike); ITM vendida → atribuição (o espelho). Sem fechamento na data, a
 * proposta é INDEFINIDA — nunca se assume pó por falta de dado (WO-30).
 *
 * Sempre com confirmação. A plataforma propõe com o número e o motivo; o trader confirma, ou
 * registra o que realmente aconteceu pela boleta.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarX, Check } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtDateBR, fmtNum } from "@/lib/format";
import type { PernaVencida } from "@/lib/boletas";
import { propostaVencimento } from "@/lib/boleta-calculos";
import { CUSTOS_SUGERIDOS_XP_B3 } from "@/lib/custos-sugeridos";

interface Proposta {
  perna: PernaVencida;
  fechamento: number | null;
  situacao: "po" | "exercicio" | "atribuicao" | "indefinida";
  texto: string;
}

export function PainelVencimentos() {
  const { livro, sincronizarLivro } = useMarket();
  const [propostas, setPropostas] = useState<Proposta[] | null>(null);
  const [processando, setProcessando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!livro.configurado) return;
    try {
      const r = await fetch("/api/boletas/vencimentos", { signal: AbortSignal.timeout(15_000) });
      const j = await r.json().catch(() => null);
      const pendentes: PernaVencida[] = Array.isArray(j?.pendentes) ? j.pendentes : [];
      if (pendentes.length === 0) {
        setPropostas([]);
        return;
      }
      // Fechamento do ativo na data do vencimento, por ticker (uma busca por ativo).
      const tickers = Array.from(new Set(pendentes.map((p) => p.ticker)));
      const candlesPorTicker = new Map<string, { date: string; close: number }[]>();
      await Promise.all(
        tickers.map(async (t) => {
          try {
            const h = await fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=1y`, { signal: AbortSignal.timeout(30_000) });
            const hj = await h.json().catch(() => null);
            candlesPorTicker.set(t, Array.isArray(hj?.candles) ? hj.candles : []);
          } catch {
            candlesPorTicker.set(t, []);
          }
        })
      );
      setPropostas(
        pendentes.map((perna) => {
          const c = candlesPorTicker.get(perna.ticker)?.find((x) => x.date === perna.vencimento);
          const fechamento = c?.close ?? null;
          const prop = propostaVencimento(perna, fechamento);
          if (prop.situacao === "indefinida") {
            return { perna, fechamento: null, situacao: "indefinida", texto: "Sem fechamento do ativo na data do vencimento — não dá para dizer se virou pó ou exerceu." };
          }
          if (prop.situacao === "po") return { perna, fechamento, situacao: "po", texto: `Fechou a ${fmtNum(fechamento!, 2)} — OTM. Virou pó.` };
          const verbo = prop.ladoAcao === 1 ? "compra" : "venda";
          if (prop.situacao === "exercicio") return { perna, fechamento, situacao: "exercicio", texto: `Fechou a ${fmtNum(fechamento!, 2)} — ITM comprada. Exercício: ${verbo} de ${perna.quantidade} ${perna.ticker} a ${fmtNum(perna.strike!, 2)}.` };
          return { perna, fechamento, situacao: "atribuicao", texto: `Fechou a ${fmtNum(fechamento!, 2)} — ITM vendida. Atribuição: ${verbo} de ${perna.quantidade} ${perna.ticker} a ${fmtNum(perna.strike!, 2)}.` };
        })
      );
    } catch (e: any) {
      setErro(e?.message ?? "erro");
    }
  }, [livro.configurado]);

  useEffect(() => {
    void carregar();
  }, [carregar, livro.totalBoletas]);

  const confirmar = async (p: Proposta) => {
    if (p.situacao === "indefinida") return;
    setProcessando(p.perna.posicaoId);
    setErro(null);
    const quando = new Date(`${p.perna.vencimento}T21:00:00Z`).toISOString();
    const boletas: Record<string, unknown>[] = [];
    if (p.situacao === "po") {
      boletas.push({ tipo: "vencimento", origem: "vencimento", executadoEm: quando, ticker: p.perna.ticker, kind: "OPTION", posicaoId: p.perna.posicaoId, quantidade: p.perna.quantidade, preco: 0, motivoSaida: "vencimento", corretagem: 0, emolumentos: 0, liquidacao: 0 });
    } else {
      // A opção sai por exercício (preço 0); a ação entra na MESMA estrutura, a strike.
      const ladoAcao = propostaVencimento(p.perna, p.fechamento).ladoAcao ?? 1;
      // XP: exercício custa Tabela Bovespa com MÍNIMO de R$ 100 por série (texto oficial, 02/09/2026).
      // Vai como corretagem da boleta de exercício; corrija pelo ajuste se a nota disser outro valor.
      boletas.push({ tipo: "exercicio", origem: "vencimento", executadoEm: quando, ticker: p.perna.ticker, kind: "OPTION", posicaoId: p.perna.posicaoId, quantidade: p.perna.quantidade, preco: 0, motivoSaida: "vencimento", corretagem: CUSTOS_SUGERIDOS_XP_B3.exercicioMinimoPorSerie, emolumentos: 0, liquidacao: 0, nota: "exercício: corretagem mínima da XP por série (Tabela Bovespa, mín. R$ 100)" });
      boletas.push({ tipo: "abertura", origem: "vencimento", executadoEm: quando, ticker: p.perna.ticker, kind: "STOCK", lado: ladoAcao, quantidade: p.perna.quantidade, preco: p.perna.strike, estruturaId: p.perna.estruturaId, nota: `exercício/atribuição de ${p.perna.opTicker ?? "opção"}` });
    }
    try {
      const r = await fetch("/api/boletas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boletas }), signal: AbortSignal.timeout(20_000) });
      const j = await r.json().catch(() => null);
      if (!r.ok) setErro(j?.error ?? `Recusado (${r.status}).`);
      await sincronizarLivro();
      await carregar();
    } catch (e: any) {
      setErro(e?.message ?? "erro");
    } finally {
      setProcessando(null);
    }
  };

  if (!livro.configurado || !propostas || propostas.length === 0) return null;

  return (
    <div className="panel border-l-2 !border-l-term-down">
      <div className="panel-title flex items-center gap-2">
        <CalendarX size={14} className="text-term-down" />
        <span className="font-bold">Vencidas sem tratamento ({propostas.length})</span>
        <span className="text-xxs text-term-dim font-normal ml-2">a plataforma propõe; você confirma — nada é gravado sozinho</span>
      </div>
      <div className="p-3 space-y-2 text-xxs">
        {propostas.map((p) => (
          <div key={p.perna.posicaoId} className="flex flex-wrap items-center gap-2 border-b border-term-line/30 pb-2 last:border-0">
            <span className="font-mono">
              <span className={p.perna.lado === 1 ? "text-term-up" : "text-term-down"}>{p.perna.lado === 1 ? "C" : "V"}</span>{" "}
              {p.perna.opTicker ?? p.perna.ticker} · {p.perna.tipoOpcao} {p.perna.strike != null ? fmtNum(p.perna.strike, 2) : ""} · venc. {fmtDateBR(p.perna.vencimento)} × {p.perna.quantidade} @ {fmtNum(p.perna.precoMedio, 2)}
            </span>
            <span className={clsx("flex-1 min-w-[16rem]", p.situacao === "indefinida" ? "text-term-gold" : "text-term-dim")}>{p.texto}</span>
            {p.situacao !== "indefinida" ? (
              <button className="btn btn-primary text-xxs flex items-center gap-1" disabled={processando === p.perna.posicaoId} onClick={() => void confirmar(p)}>
                <Check size={11} /> {processando === p.perna.posicaoId ? "Gravando…" : "Confirmar"}
              </button>
            ) : (
              <span className="text-term-dim">registre o que aconteceu pela boleta</span>
            )}
          </div>
        ))}
        {erro && <div className="text-term-down">{erro}</div>}
        <p className="text-term-dim">
          Exercício e atribuição entram como ação na mesma estrutura, a strike. A XP cobra exercício pela Tabela Bovespa com mínimo de {fmtBRL(CUSTOS_SUGERIDOS_XP_B3.exercicioMinimoPorSerie)} por série — é o que a boleta de exercício traz como corretagem; fechar ou rolar antes do vencimento evita esse piso. Corrija pela boleta (ajuste) se a nota disser outro valor.
        </p>
      </div>
    </div>
  );
}
