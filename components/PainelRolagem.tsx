"use client";

/**
 * WO-53 — a rolagem de uma estrutura, como análise; WO-58 — a execução vai para a Boletagem.
 *
 * Mostra a proposta (`propostaRolagem`) com os preços de referência (marcação para fechar, último
 * ou mid para abrir), deixa ajustá-los, e "Mandar para a Boletagem" cria UM rascunho de rolagem com
 * as pernas que fecham e as que abrem. Nada é gravado aqui: o preço da execução é digitado lá, e
 * as N boletas nascem na mesma transação. Sem livro no banco, a rolagem não existe.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import clsx from "clsx";
import { markInfo, useMarket } from "@/store/market";
import { propostaRolagem } from "@/lib/rolagem";
import { criarRascunhoRemoto } from "@/lib/hooks/useRascunhos";
import { rascunhoDeRolagem } from "@/lib/rascunhos";
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
  const { chainCache, livro } = useMarket();
  const router = useRouter();
  const chain = chainCache[pernas[0]?.underlying] ?? null;
  const marcacoes = useMemo(() => Object.fromEntries(pernas.map((p) => [p.id, markInfo(p, chainCache).price])), [pernas, chainCache]);
  const proposta = useMemo(() => propostaRolagem({ pernas, chain, tabela: tabelaCustos, marcacoes }), [pernas, chain, tabelaCustos, marcacoes]);

  const [precosFechar, setPrecosFechar] = useState<Record<string, string>>(() => Object.fromEntries(proposta.fechar.map((f) => [f.posicao.id, f.preco != null ? f.preco.toFixed(2) : ""])));
  const [precosAbrir, setPrecosAbrir] = useState<Record<string, string>>(() => Object.fromEntries(proposta.abrir.map((a) => [a.opcao.opTicker, a.preco.toFixed(2)])));
  const [estado, setEstado] = useState<"parado" | "mandando">("parado");
  const [msg, setMsg] = useState<string | null>(null);

  const parse = (v: string) => {
    const n = Number((v ?? "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const doBanco = pernas.every((p) => /^db-\d+$/.test(p.id));
  const faltando = proposta.fechar.filter((f) => parse(precosFechar[f.posicao.id] ?? "") == null).length + proposta.abrir.filter((a) => parse(precosAbrir[a.opcao.opTicker] ?? "") == null).length;

  // WO-58: os preços editados aqui viram o preço de MONTAGEM do rascunho (referência). A execução
  // é digitada na Boletagem.
  const mandar = async () => {
    setEstado("mandando");
    setMsg(null);
    const editada = {
      ...proposta,
      fechar: proposta.fechar.map((f) => ({ ...f, preco: parse(precosFechar[f.posicao.id] ?? "") })),
      abrir: proposta.abrir.map((a) => ({ ...a, preco: parse(precosAbrir[a.opcao.opTicker] ?? "") ?? a.preco })),
    };
    const r = await criarRascunhoRemoto(rascunhoDeRolagem(editada, pernas[0]));
    setEstado("parado");
    if (!r.ok || !r.rascunho) {
      setMsg(r.mensagem);
      return;
    }
    onRolado();
    router.push(`/boletagem#rascunho-${r.rascunho.id}`);
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
          <div className="text-term-dim uppercase tracking-wider mb-1">Abrir (referência: último/mid)</div>
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
        <button className="btn btn-primary disabled:opacity-50" disabled={!doBanco || !livro.configurado || proposta.abrir.length === 0 || estado !== "parado"} onClick={() => void mandar()} title="Cria um rascunho de rolagem (fechar + abrir) na Boletagem; o preço da execução é digitado lá">
          {estado === "mandando" ? "Mandando…" : "Mandar para a Boletagem"}
        </button>
        <button className="btn text-term-dim" onClick={onCancelar}>Cancelar</button>
        {!doBanco && <span className="text-term-gold">rolagem só com o livro no banco</span>}
        {faltando > 0 && <span className="text-term-dim">{faltando} preço(s) de referência em branco — a Boletagem pede o da execução</span>}
        {msg && <span className="text-term-down">{msg}</span>}
      </div>
    </div>
  );
}
