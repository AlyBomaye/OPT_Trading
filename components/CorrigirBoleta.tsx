"use client";

/**
 * WO-68 — corrigir uma boleta pela fita.
 *
 * O livro é append-only: aqui não se edita nada. O formulário abre preenchido com a boleta como ela
 * está e, ao confirmar, a plataforma grava o ESTORNO dela e a BOLETA CERTA na mesma transação. A
 * fita passa a mostrar a versão que vale, com a trilha a um clique.
 *
 * O operador pediu poder mexer em TUDO, inclusive instrumento, lado e tipo (22/09/2026). A defesa
 * contra o engano é a prévia: o diff campo a campo antes de gravar, com a troca estrutural em âmbar.
 */

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { camposAlterados, entradaDaCorrecao } from "@/lib/correcao-boleta";
import type { BoletaRegistrada, EntradaBoleta } from "@/lib/boletas";
import { fmtBRL } from "@/lib/format";

const TIPOS: Array<EntradaBoleta["tipo"]> = ["abertura", "fechamento", "exercicio", "vencimento", "caixa"];
const MOTIVOS = ["", "alvo", "stop", "regime", "vencimento", "manual"];

/** Número digitado: guarda o TEXTO (a vírgula não some no meio da digitação) e deriva o número. */
function numero(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function CorrigirBoleta({ boleta, onFechar }: { boleta: BoletaRegistrada; onFechar: () => void }) {
  const { sincronizarLivro } = useMarket();
  const base = useMemo(() => entradaDaCorrecao(boleta), [boleta]);

  const [tipo, setTipo] = useState<EntradaBoleta["tipo"]>(base.tipo);
  const [executadoEm, setExecutadoEm] = useState(String(base.executadoEm).slice(0, 16));
  const [ticker, setTicker] = useState(base.ticker);
  const [opTicker, setOpTicker] = useState(base.opTicker ?? "");
  const [tipoOpcao, setTipoOpcao] = useState(base.tipoOpcao ?? "");
  const [strike, setStrike] = useState(base.strike != null ? String(base.strike) : "");
  const [vencimento, setVencimento] = useState(base.vencimento ?? "");
  const [lado, setLado] = useState<1 | -1 | "">(base.lado ?? "");
  const [quantidade, setQuantidade] = useState(String(base.quantidade));
  const [preco, setPreco] = useState(String(base.preco));
  const [corretagem, setCorretagem] = useState(String(base.corretagem ?? 0));
  const [emolumentos, setEmolumentos] = useState(String(base.emolumentos ?? 0));
  const [liquidacao, setLiquidacao] = useState(String(base.liquidacao ?? 0));
  const [registro, setRegistro] = useState(String(base.registro ?? 0));
  const [taxaOperacional, setTaxaOperacional] = useState(String(base.taxaOperacional ?? 0));
  const [motivoSaida, setMotivoSaida] = useState(base.motivoSaida ?? "");
  const [nota, setNota] = useState(base.nota ?? "");

  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const nova: EntradaBoleta = useMemo(
    () => ({
      ...base,
      tipo,
      executadoEm: executadoEm.length === 16 ? `${executadoEm}:00` : executadoEm,
      ticker: ticker.toUpperCase().trim(),
      opTicker: opTicker.trim() || null,
      tipoOpcao: (tipoOpcao || null) as EntradaBoleta["tipoOpcao"],
      strike: numero(strike),
      vencimento: vencimento || null,
      lado: lado === "" ? undefined : lado,
      quantidade: numero(quantidade) ?? 0,
      preco: numero(preco) ?? 0,
      corretagem: numero(corretagem) ?? 0,
      emolumentos: numero(emolumentos) ?? 0,
      liquidacao: numero(liquidacao) ?? 0,
      registro: numero(registro) ?? 0,
      taxaOperacional: numero(taxaOperacional) ?? 0,
      motivoSaida: (motivoSaida || null) as EntradaBoleta["motivoSaida"],
      nota: nota.trim() || null,
    }),
    [base, tipo, executadoEm, ticker, opTicker, tipoOpcao, strike, vencimento, lado, quantidade, preco, corretagem, emolumentos, liquidacao, registro, taxaOperacional, motivoSaida, nota]
  );

  const mudancas = useMemo(() => camposAlterados(boleta, nova), [boleta, nova]);
  const estruturais = mudancas.filter((m) => m.estrutural);

  async function chamar(gravar: boolean) {
    setOcupado(true);
    setErro(null);
    setPrevia(null);
    try {
      const r = await fetch(`/api/boletas/corrigir${gravar ? "" : "?simular=1"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: boleta.id, nova }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErro(j?.error ?? "Correção recusada.");
        return;
      }
      if (gravar) {
        await sincronizarLivro();
        onFechar();
        return;
      }
      const c = j?.corrigida?.custos;
      const soma = c ? c.corretagem + c.emolumentos + c.liquidacao + c.registro + c.taxaOperacional : null;
      setPrevia(
        `Passa: estorno #${j?.estorno?.boletaId ?? "?"} e boleta certa #${j?.corrigida?.boletaId ?? "?"}` +
          (soma != null ? ` · custos da nova ${fmtBRL(soma)}${c.calculadoPelaTabela ? " (tabela vigente)" : " (informados)"}` : "") +
          (j?.corrigida?.estruturaId != null ? ` · estrutura #${j.corrigida.estruturaId}` : "")
      );
    } catch (e: any) {
      setErro(e?.message ?? "Falha ao falar com o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  const campo = "bg-term-panel2 border border-term-line rounded px-1.5 py-1 font-mono text-term-text w-full";

  return (
    <div className="panel border border-term-cyan/50">
      <div className="panel-title flex items-center gap-2">
        <span className="font-bold text-term-cyan">Corrigir a boleta #{boleta.id}</span>
        <span className="text-xxs text-term-dim font-normal">
          o livro não muda: grava-se o estorno desta e a boleta certa, na mesma transação
        </span>
        <button className="btn ml-auto text-term-dim" onClick={onFechar}>fechar</button>
      </div>

      <div className="p-3 space-y-2.5 text-xxs">
        <div className="flex flex-wrap items-center gap-1.5">
          {TIPOS.map((t) => (
            <button key={t} type="button" onClick={() => setTipo(t)}
              className={clsx("px-2 py-1 rounded border font-mono", tipo === t ? "bg-term-cyan/15 border-term-cyan/50 text-term-cyan" : "bg-term-panel2 border-term-line text-term-dim")}>
              {t}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="space-y-0.5"><div className="text-term-dim">Executada em</div>
            <input type="datetime-local" value={executadoEm} onChange={(e) => setExecutadoEm(e.target.value)} className={campo} /></label>
          <label className="space-y-0.5"><div className="text-term-dim">Ativo</div>
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} className={campo} /></label>
          <label className="space-y-0.5"><div className="text-term-dim">Série (opção)</div>
            <input value={opTicker} onChange={(e) => setOpTicker(e.target.value)} className={campo} placeholder="—" /></label>
          <label className="space-y-0.5"><div className="text-term-dim">CALL/PUT</div>
            <select value={tipoOpcao} onChange={(e) => setTipoOpcao(e.target.value)} className={campo}>
              <option value="">—</option><option value="CALL">CALL</option><option value="PUT">PUT</option>
            </select></label>
          <label className="space-y-0.5"><div className="text-term-dim">Strike</div>
            <input value={strike} onChange={(e) => setStrike(e.target.value)} inputMode="decimal" className={campo} /></label>
          <label className="space-y-0.5"><div className="text-term-dim">Vencimento</div>
            <input type="date" value={vencimento ?? ""} onChange={(e) => setVencimento(e.target.value)} className={campo} /></label>
          <label className="space-y-0.5"><div className="text-term-dim">Lado</div>
            <select value={String(lado)} onChange={(e) => setLado(e.target.value === "" ? "" : (Number(e.target.value) as 1 | -1))} className={campo}>
              <option value="">—</option><option value="1">Compra</option><option value="-1">Venda</option>
            </select></label>
          <label className="space-y-0.5"><div className="text-term-dim">Quantidade</div>
            <input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="numeric" className={campo} /></label>
          <label className="space-y-0.5"><div className="text-term-dim">{tipo === "caixa" ? "Valor (R$)" : "Preço executado"}</div>
            <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" className={campo} /></label>
          <label className="space-y-0.5"><div className="text-term-dim">Motivo</div>
            <select value={motivoSaida} onChange={(e) => setMotivoSaida(e.target.value)} className={campo}>
              {MOTIVOS.map((m) => <option key={m} value={m}>{m || "—"}</option>)}
            </select></label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {([["Corretagem", corretagem, setCorretagem], ["Emolumentos", emolumentos, setEmolumentos], ["Liquidação", liquidacao, setLiquidacao], ["Registro", registro, setRegistro], ["Taxa oper.", taxaOperacional, setTaxaOperacional]] as Array<[string, string, (v: string) => void]>).map(([rotulo, valor, set]) => (
            <label key={rotulo} className="space-y-0.5"><div className="text-term-dim">{rotulo}</div>
              <input value={valor} onChange={(e) => set(e.target.value)} inputMode="decimal" className={campo} /></label>
          ))}
        </div>

        <label className="block space-y-0.5"><div className="text-term-dim">Nota</div>
          <input value={nota} onChange={(e) => setNota(e.target.value)} className={campo} placeholder="o que estava errado" /></label>

        {/* o diff — a defesa contra o engano, já que tudo é editável */}
        <div className="border border-term-line rounded p-2 bg-term-panel2/40">
          {mudancas.length === 0 ? (
            <div className="text-term-dim">Nada mudou ainda — altere um campo para corrigir.</div>
          ) : (
            <>
              <div className="text-term-dim mb-1">{mudancas.length} campo(s) mudam:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                {mudancas.map((m) => (
                  <div key={m.campo} className={clsx("flex items-baseline gap-1 font-mono", m.estrutural ? "text-term-gold" : "text-term-text")}>
                    <span className="text-term-dim">{m.rotulo}</span>
                    <span className="line-through text-term-dim">{m.de}</span>
                    <span>→</span>
                    <span className="font-bold">{m.para}</span>
                  </div>
                ))}
              </div>
              {estruturais.length > 0 && (
                <div className="mt-1.5 text-term-gold">
                  Atenção: {estruturais.map((m) => m.rotulo.toLowerCase()).join(", ")} — isto não é consertar um preço, é
                  registrar outra boleta. Confirme contra a nota da corretora antes de gravar.
                </div>
              )}
            </>
          )}
        </div>

        {erro && <div className="text-term-down border border-term-down/40 rounded px-2 py-1">{erro}</div>}
        {previa && <div className="text-term-cyan border border-term-cyan/40 rounded px-2 py-1">{previa}</div>}

        <div className="flex items-center gap-2">
          <button className="btn text-term-cyan" disabled={ocupado || mudancas.length === 0} onClick={() => void chamar(false)}>
            Prévia (não grava)
          </button>
          <button className="btn bg-term-cyan/15 border-term-cyan/50 text-term-cyan" disabled={ocupado || mudancas.length === 0} onClick={() => void chamar(true)}>
            Gravar estorno + boleta certa
          </button>
          <span className="text-term-dim ml-auto">
            a original continua no livro, riscada na fita — nada é apagado
          </span>
        </div>
      </div>
    </div>
  );
}
