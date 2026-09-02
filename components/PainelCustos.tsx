"use client";

/**
 * WO-48 §6 — a tabela de custos, com vigência e fonte.
 *
 * Nenhum percentual é inventado pelo código: a tela nasce vazia e pede que você confirme os
 * valores contra a tabela vigente da B3 e a sua corretora, gravando a fonte. Cada gravação é uma
 * nova vigência — boleta antiga continua com a tabela da época.
 *
 * Percentuais em FRAÇÃO do financeiro: 0,0003 = 0,03%. A rota recusa acima de 5% porque quase
 * certamente foi digitado em porcento.
 */

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtDateBR, fmtPct } from "@/lib/format";
import type { ConfigCustos } from "@/lib/boletas";
import type { CustosSugeridos } from "@/lib/custos-sugeridos";

export function PainelCustos() {
  const { livro } = useMarket();
  const [vigente, setVigente] = useState<ConfigCustos | null>(null);
  const [aberto, setAberto] = useState(false);
  const [corretagem, setCorretagem] = useState("");
  const [emol, setEmol] = useState("");
  const [liq, setLiq] = useState("");
  const [reg, setReg] = useState("");
  const [oper, setOper] = useState("");
  const [imp, setImp] = useState("");
  const [sugestao, setSugestao] = useState<CustosSugeridos | null>(null);
  const [fonte, setFonte] = useState("");
  const [desde, setDesde] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = () =>
    fetch("/api/custos", { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setVigente(j?.custos ?? null);
        setSugestao(j?.sugestao ?? null);
      })
      .catch(() => setVigente(null));

  useEffect(() => {
    if (livro.configurado) void carregar();
  }, [livro.configurado]);

  if (!livro.configurado) return null;

  const gravar = async () => {
    setMsg(null);
    const n = (v: string) => Number(v.replace(",", "."));
    try {
      const r = await fetch("/api/custos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vigenteDesde: desde, corretagemFixa: n(corretagem), emolumentosPct: n(emol), liquidacaoPct: n(liq), registroPct: reg === "" ? 0 : n(reg), taxaOperacionalPct: oper === "" ? 0 : n(oper), impostosCorretagemPct: imp === "" ? 0 : n(imp), fonte: fonte.trim() || null }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(j?.error ?? `Recusado (${r.status}).`);
        return;
      }
      setMsg("Tabela gravada.");
      setAberto(false);
      await carregar();
    } catch (e: any) {
      setMsg(e?.message ?? "erro");
    }
  };

  return (
    <div className="panel">
      <div className="panel-title flex items-center justify-between gap-2 cursor-pointer select-none" onClick={() => setAberto((a) => !a)}>
        <div className="flex items-center gap-2">
          <Receipt size={14} className="text-term-gold" />
          <span className="font-bold">Custos por boleta</span>
        </div>
        <span className="text-xxs font-normal text-term-dim">
          {vigente
            ? `corretagem ${fmtBRL(vigente.corretagemFixa)} · B3 ${fmtPct(vigente.emolumentosPct + vigente.liquidacaoPct + vigente.registroPct)} · taxa operacional ${fmtPct(vigente.taxaOperacionalPct)} · desde ${fmtDateBR(vigente.vigenteDesde)}`
            : "não confirmada — a boleta usa a tabela SUGERIDA (B3 oficial + XP a confirmar)"}
        </span>
      </div>
      {aberto && (
        <div className="p-3 space-y-2 text-xxs">
          <p className="text-term-dim leading-relaxed">
            Confirme contra a tabela vigente da B3 e a sua corretora. Percentuais em fração do financeiro
            (0,0003 = 0,03%). Gravar cria uma nova vigência; as boletas antigas ficam com a tabela da época.
          </p>
          {sugestao && (
            <div className="border border-term-gold/40 bg-term-gold/5 rounded p-2 space-y-1">
              <div className="font-semibold text-term-gold">Sugestão com proveniência — confirme contra a sua nota</div>
              <div className="font-mono">
                corretagem {fmtBRL(sugestao.corretagemFixa)} (+{fmtPct(sugestao.impostosCorretagemPct)} de impostos = {fmtBRL(sugestao.corretagemFixa * (1 + sugestao.impostosCorretagemPct))} na nota) · B3 negociação {fmtPct(sugestao.emolumentosPct)} + liquidação {fmtPct(sugestao.liquidacaoPct)} + registro {fmtPct(sugestao.registroPct)} · taxa operacional {fmtPct(sugestao.taxaOperacionalPct)} · exercício mín. {fmtBRL(sugestao.exercicioMinimoPorSerie)}/série
              </div>
              <div className="text-term-dim leading-relaxed">{sugestao.fonte}</div>
              <ul className="text-term-dim list-disc pl-4 space-y-0.5">
                {sugestao.observacoes.map((o) => <li key={o}>{o}</li>)}
              </ul>
              <button
                className="btn text-xxs"
                onClick={() => {
                  setCorretagem(String(sugestao.corretagemFixa));
                  setEmol(String(sugestao.emolumentosPct));
                  setLiq(String(sugestao.liquidacaoPct));
                  setReg(String(sugestao.registroPct));
                  setOper(String(sugestao.taxaOperacionalPct));
                  setImp(String(sugestao.impostosCorretagemPct));
                  setFonte(sugestao.fonte.slice(0, 200));
                }}
              >
                Preencher com a sugestão
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-8 gap-2">
            <label className="space-y-0.5"><div className="text-term-dim">Vigente desde</div><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="cell-input !w-full" /></label>
            <label className="space-y-0.5"><div className="text-term-dim">Corretagem fixa (R$)</div><input value={corretagem} onChange={(e) => setCorretagem(e.target.value)} inputMode="decimal" className="cell-input !w-full text-right" /></label>
            <label className="space-y-0.5"><div className="text-term-dim">Emolumentos (fração)</div><input value={emol} onChange={(e) => setEmol(e.target.value)} inputMode="decimal" placeholder="0,0003" className="cell-input !w-full text-right" /></label>
            <label className="space-y-0.5"><div className="text-term-dim">Liquidação (fração)</div><input value={liq} onChange={(e) => setLiq(e.target.value)} inputMode="decimal" placeholder="0,00025" className="cell-input !w-full text-right" /></label>
            <label className="space-y-0.5"><div className="text-term-dim">Registro B3 (fração)</div><input value={reg} onChange={(e) => setReg(e.target.value)} inputMode="decimal" placeholder="0,000695" className="cell-input !w-full text-right" /></label>
            <label className="space-y-0.5"><div className="text-term-dim">Taxa operacional (fração)</div><input value={oper} onChange={(e) => setOper(e.target.value)} inputMode="decimal" placeholder="0,059" className="cell-input !w-full text-right" /></label>
            <label className="space-y-0.5"><div className="text-term-dim">Impostos s/ corretagem (fração)</div><input value={imp} onChange={(e) => setImp(e.target.value)} inputMode="decimal" placeholder="0,0965" className="cell-input !w-full text-right" /></label>
            <label className="space-y-0.5"><div className="text-term-dim">Fonte</div><input value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="URL da tabela / nota" className="cell-input !w-full !text-left" /></label>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" onClick={() => void gravar()}>Gravar vigência</button>
            {msg && <span className={msg === "Tabela gravada." ? "text-term-up" : "text-term-down"}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
