"use client";

/**
 * WO-48 §8 — a migração do navegador para o banco, uma vez.
 *
 * Aparece só quando o banco está configurado, o livro no banco está VAZIO e o navegador tem
 * posições. Mostra o resumo do que vai virar boleta e pede confirmação — é o único passo do WO-48
 * que, na prática, não tem volta (as boletas nascem `origem: migracao`, append-only).
 *
 * Depois de migrar, o store passa a ser cache do banco; o que estava no navegador é substituído
 * pelo que voltou — e o P&L de cada estrutura tem de ser o mesmo de antes.
 */

import { useState } from "react";
import { Database, Check } from "lucide-react";
import { useMarket } from "@/store/market";
import { fmtBRL } from "@/lib/format";

export function MigracaoLivro() {
  const { positions, closed, capitalTotal, livro, sincronizarLivro } = useMarket();
  const [migrando, setMigrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const precisa = livro.configurado && livro.totalBoletas === 0 && (positions.length > 0 || closed.length > 0);
  if (!precisa && !feito) return null;

  const estruturas = new Set([...positions, ...closed].map((p) => `${p.underlying}|${p.openedAt}`)).size;

  const migrar = async () => {
    setMigrando(true);
    setErro(null);
    try {
      const res = await fetch("/api/boletas/migrar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions, closed, capitalTotal }), signal: AbortSignal.timeout(60_000),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.migrado) {
        setErro(j?.error ?? `Migração recusada (${res.status}). Nada foi gravado.`);
        return;
      }
      const r = j.resumo;
      setFeito(`Migrado: ${r.estruturas} estrutura(s), ${r.pernas} perna(s), ${r.aberturas} abertura(s), ${r.fechamentos} fechamento(s), caixa ${fmtBRL(r.caixa)}.`);
      await sincronizarLivro();
    } catch (e: any) {
      setErro(`Falha: ${e?.message ?? "erro"}`);
    } finally {
      setMigrando(false);
    }
  };

  return (
    <div className="panel border-l-2 !border-l-term-gold">
      <div className="panel-title flex items-center gap-2">
        <Database size={14} className="text-term-gold" />
        <span className="font-bold">Levar o livro para o banco</span>
      </div>
      <div className="p-3 space-y-2 text-xxs">
        {feito ? (
          <p className="text-term-up flex items-center gap-1"><Check size={12} /> {feito}</p>
        ) : (
          <>
            <p className="leading-relaxed">
              O banco está configurado e o livro lá está vazio. Este navegador tem{" "}
              <b>{positions.length} perna(s) aberta(s)</b>, <b>{closed.length} fechada(s)</b>, em{" "}
              <b>{estruturas} estrutura(s)</b>, e capital de <b>{fmtBRL(capitalTotal)}</b>.
              Cada uma vira uma boleta <code>origem: migracao</code>, com a data original preservada;
              o capital vira o aporte inicial. Depois disso o navegador passa a ser cache do banco.
            </p>
            <p className="text-term-dim leading-relaxed">
              Roda uma vez só e não tem desfazer — boleta é append-only. O P&amp;L de cada estrutura
              tem de ser o mesmo de antes; se não for, é bug e você deve me avisar.
            </p>
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" disabled={migrando} onClick={migrar}>
                {migrando ? "Migrando…" : "Confirmar migração"}
              </button>
              {erro && <span className="text-term-down">{erro}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
