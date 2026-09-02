"use client";

/**
 * WO-53 — a rolagem de uma estrutura, numa boleta composta.
 *
 * Mostra a proposta (`propostaRolagem`), deixa editar os preços de fechar e abrir, pede a prévia
 * ao servidor (`?simular=1`, nada gravado) e só então boleta — N fechamentos e N aberturas na mesma
 * transação. Sem banco, a rolagem não existe: a plataforma não guarda boleta só no navegador.
 */

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import clsx from "clsx";
import { markInfo, useMarket } from "@/store/market";
import { propostaRolagem } from "@/lib/rolagem";
import { fmtBRL, fmtDateBR, fmtNum } from "@/lib/format";
import type { Position } from "@/lib/types";
import type { TabelaCustos } from "@/lib/boleta-calculos";

interface Props {
  pernas: Position[];
  tabelaCustos: TabelaCustos | null;
  onCancelar: () => void;
  onRolado: () => void;
}

export function PainelRolagem({ pernas, tabelaCustos, onCancelar, onRolado }: Props) {
  const { chainCache, livro, sincronizarLivro } = useMarket();
  const chain = chainCache[pernas[0]?.underlying] ?? null;
  const marcacoes = useMemo(() => Object.fromEntries(pernas.map((p) => [p.id, markInfo(p, chainCache).price])), [pernas, chainCache]);
  const proposta = useMemo(() => propostaRolagem({ pernas, chain, tabela: tabelaCustos, marcacoes }), [pernas, chain, tabelaCustos, marcacoes]);

  const [precosFechar, setPrecosFechar] = useState<Record<string, string>>(() => Object.fromEntries(proposta.fechar.map((f) => [f.posicao.id, f.preco != null ? f.preco.toFixed(2) : ""])));
  const [precosAbrir, setPrecosAbrir] = useState<Record<string, string>>(() => Object.fromEntries(proposta.abrir.map((a) => [a.opcao.opTicker, a.preco.toFixed(2)])));
  const [estado, setEstado] = useState<"parado" | "simulando" | "boletando">("parado");
  const [msg, setMsg] = useState<string | null>(null);

  const parse = (v: string) => {
    const n = Number((v ?? "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const doBanco = pernas.every((p) => /^db-\d+$/.test(p.id));
  const faltando = proposta.fechar.filter((f) => parse(precosFechar[f.posicao.id] ?? "") == null).length + proposta.abrir.filter((a) => parse(precosAbrir[a.opcao.opTicker] ?? "") == null).length;

  const montarCorpo = () => {
    const agora = new Date().toISOString();
    const lider = pernas[0];
    const fechamentos = proposta.fechar.map((f) => ({
      tipo: "fechamento", origem: "manual", executadoEm: agora, ticker: f.posicao.underlying, kind: "OPTION",
      posicaoId: Number(f.posicao.id.slice(3)), quantidade: Math.abs(f.posicao.qty), preco: parse(precosFechar[f.posicao.id] ?? "")!,
      motivoSaida: "vencimento", nota: `rolagem para ${proposta.vencimentoNovo}`,
    }));
    const aberturas = proposta.abrir.map((a, i) => ({
      tipo: "abertura", origem: "manual", executadoEm: agora, ticker: a.opcao.underlying, kind: "OPTION",
      opTicker: a.opcao.opTicker, tipoOpcao: a.opcao.type, modelo: a.opcao.model, strike: a.opcao.strike, vencimento: a.opcao.expiry,
      lado: a.side, quantidade: a.qty, preco: parse(precosAbrir[a.opcao.opTicker] ?? "")!, ivEntrada: a.opcao.iv ?? null,
      gregasEntrada: { delta: a.opcao.delta, vega: a.opcao.vega, theta: a.opcao.theta },
      nota: `rolagem da estrutura ${lider.estruturaId ?? ""}`.trim(),
      ...(i === 0 ? { novaEstrutura: { nomeDetectado: null, tese: lider.tese ? `Rolagem — ${lider.tese}` : "Rolagem", alvo: lider.alvo ?? null, regraSaida: lider.regraSaida ?? null, regimeEntrada: lider.regimeNaEntrada ?? null } } : {}),
    }));
    return { fechamentos, aberturas };
  };

  const enviar = async (simular: boolean) => {
    setEstado(simular ? "simulando" : "boletando");
    setMsg(null);
    try {
      const r = await fetch(`/api/boletas/rolar${simular ? "?simular=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(montarCorpo()), signal: AbortSignal.timeout(30_000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || (!simular && !j?.gravado)) {
        setMsg(j?.error ?? `Recusado (${r.status}). Nada foi gravado.`);
        return;
      }
      if (simular) {
        const custos = (j.resultados as any[]).reduce((a, x) => a + (x?.custos ? x.custos.corretagem + x.custos.emolumentos + x.custos.liquidacao + x.custos.registro + x.custos.taxaOperacional : 0), 0);
        setMsg(`Prévia (nada gravado): ${j.resultados.length} boleta(s) na mesma transação, custos reais ${fmtBRL(custos)}.`);
      } else {
        setMsg(`Rolagem gravada: ${j.resultados.length} boleta(s).`);
        await sincronizarLivro();
        onRolado();
      }
    } catch (e: any) {
      setMsg(`Falha: ${e?.message ?? "erro"}`);
    } finally {
      setEstado("parado");
    }
  };

  return (
    <div className="space-y-2 text-xxs">
      <div className="font-semibold flex items-center gap-2">
        <RefreshCw size={12} className="text-term-cyan" /> Rolar a estrutura
        {proposta.vencimentoNovo && (
          <span className={clsx("tag", proposta.foraDaJanela ? "bg-term-gold/15 text-term-gold" : "bg-term-cyan/15 text-term-cyan")}>
            → {fmtDateBR(proposta.vencimentoNovo)} · {proposta.duNovo} DU{proposta.foraDaJanela ? " (fora da janela)" : ""}
          </span>
        )}
      </div>
      {proposta.avisos.map((a, i) => <div key={i} className="text-term-gold">⚠ {a}</div>)}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        <div>
          <div className="text-term-dim uppercase tracking-wider mb-1">Fechar (à marcação)</div>
          {proposta.fechar.map((f) => (
            <label key={f.posicao.id} className="flex items-center justify-between gap-2 font-mono">
              <span><span className={f.posicao.side === 1 ? "text-term-up" : "text-term-down"}>{f.posicao.side === 1 ? "V" : "C"}</span> {f.posicao.type} {fmtNum(f.posicao.strike ?? 0)} × {Math.abs(f.posicao.qty)}</span>
              <span className="flex items-center gap-1"><span className="text-term-dim">R$</span>
                <input value={precosFechar[f.posicao.id] ?? ""} onChange={(e) => setPrecosFechar({ ...precosFechar, [f.posicao.id]: e.target.value })} inputMode="decimal" placeholder="sem marca" className={clsx("w-20 bg-term-panel2 border rounded px-2 py-1 font-mono text-right outline-none focus:border-term-cyan", parse(precosFechar[f.posicao.id] ?? "") == null ? "border-term-down" : "border-term-line")} />
              </span>
            </label>
          ))}
        </div>
        <div>
          <div className="text-term-dim uppercase tracking-wider mb-1">Abrir (último negócio)</div>
          {proposta.abrir.map((a) => (
            <label key={a.opcao.opTicker} className="flex items-center justify-between gap-2 font-mono">
              <span><span className={a.side === 1 ? "text-term-up" : "text-term-down"}>{a.side === 1 ? "C" : "V"}</span> {a.opcao.opTicker} {a.opcao.type} {fmtNum(a.opcao.strike)} × {a.qty}</span>
              <span className="flex items-center gap-1"><span className="text-term-dim">R$</span>
                <input value={precosAbrir[a.opcao.opTicker] ?? ""} onChange={(e) => setPrecosAbrir({ ...precosAbrir, [a.opcao.opTicker]: e.target.value })} inputMode="decimal" className="w-20 bg-term-panel2 border border-term-line rounded px-2 py-1 font-mono text-right outline-none focus:border-term-cyan" />
              </span>
            </label>
          ))}
          {proposta.abrir.length === 0 && <div className="text-term-dim">nenhuma série líquida no vencimento novo</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 font-mono border-t border-term-line/40 pt-1">
        <span>Caixa da rolagem: <b className={proposta.bruto >= 0 ? "text-term-up" : "text-term-down"}>{proposta.bruto >= 0 ? "+" : ""}{fmtBRL(proposta.bruto)}</b> bruto</span>
        <span className="text-term-dim">custos fechar + abrir {fmtBRL(proposta.custos)}</span>
        <span>líquido <b className={proposta.liquido >= 0 ? "text-term-up" : "text-term-down"}>{proposta.liquido >= 0 ? "+" : ""}{fmtBRL(proposta.liquido)}</b></span>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button className="btn" disabled={!doBanco || !livro.configurado || faltando > 0 || proposta.abrir.length === 0 || estado !== "parado"} onClick={() => void enviar(true)}>
          {estado === "simulando" ? "Simulando…" : "Prévia (nada gravado)"}
        </button>
        <button className="btn btn-primary disabled:opacity-50" disabled={!doBanco || !livro.configurado || faltando > 0 || proposta.abrir.length === 0 || estado !== "parado"} onClick={() => void enviar(false)}>
          {estado === "boletando" ? "Boletando…" : "Boletar rolagem"}
        </button>
        <button className="btn text-term-dim" onClick={onCancelar}>Cancelar</button>
        {!doBanco && <span className="text-term-gold">rolagem só com o livro no banco</span>}
        {msg && <span className="text-term-cyan">{msg}</span>}
      </div>
    </div>
  );
}
