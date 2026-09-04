"use client";

/**
 * WO-58 — a Boletagem: a única porta por onde uma transação entra no livro.
 *
 * A execução acontece no Profit. Aqui a estrutura espera (rascunho), recebe o preço que saiu de
 * verdade e vira boleta. A ordem dos blocos é a do fluxo: o que está esperando, a boleta manual,
 * os vencimentos que a B3 resolveu sozinha, a nota da corretora para conferir, a tabela de custos,
 * a migração antiga e a fita — registrei? está lá.
 *
 * Nada de análise nesta tela: risco, alocação e veredito vivem no Portfolio (3).
 */

import { useEffect, useState } from "react";
import { useMarket } from "@/store/market";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PainelRascunhos } from "@/components/PainelRascunhos";
import { FormularioBoleta } from "@/components/FormularioBoleta";
import { PainelVencimentos } from "@/components/PainelVencimentos";
import { ReconciliacaoNota } from "@/components/ReconciliacaoNota";
import { PainelCustos } from "@/components/PainelCustos";
import { MigracaoLivro } from "@/components/MigracaoLivro";
import { UltimasBoletas } from "@/components/UltimasBoletas";
import { TruthBar } from "@/components/TruthBar";

export default function BoletagemPage() {
  const { livro, sincronizarLivro } = useMarket();

  useEffect(() => {
    void sincronizarLivro();
  }, [sincronizarLivro]);

  // A boleta manual nasce ABERTA aqui — esta é a tela dela. B foca.
  const [boletaAberta, setBoletaAberta] = usePersistedState<boolean>("boletagem-boleta-open", true);
  const [focarBoleta, setFocarBoleta] = useState(false);
  const [boletaTipoInicial, setBoletaTipoInicial] = useState<"abertura" | "fechamento" | "caixa" | undefined>(undefined);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#boleta") {
      setBoletaAberta(true);
      setFocarBoleta(true);
    }
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "b" || e.key === "B") {
        setBoletaAberta(true);
        setFocarBoleta(true);
        document.getElementById("boleta")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBoletaAberta]);

  return (
    <>
      <TruthBar />

      {livro.consultadoEm && !livro.configurado && (
        <div className="panel px-3 py-2 text-xs text-term-gold border border-term-gold/40">
          <b>Sem banco</b> — {livro.aviso ?? "banco indisponível"}. Nada é gravado até o banco voltar: a plataforma não guarda boleta, nem rascunho, só no navegador.
        </div>
      )}

      <div className="panel px-3 py-2 text-xxs text-term-dim">
        <b className="text-term-text">Decidir, executar, registrar.</b> A Estratégia (8) e o Portfolio (3) decidem e mandam a estrutura para cá como rascunho; o Profit executa; aqui você
        digita o preço que saiu de verdade e confirma. Nenhuma transação entra no livro por outra porta.
      </div>

      {/* 1. Rascunhos pendentes — o coração */}
      <PainelRascunhos />

      {/* 2. Boleta manual — aberta por padrão */}
      {boletaAberta ? (
        <div id="boleta">
          <FormularioBoleta aberto onFechar={() => { setBoletaAberta(false); setBoletaTipoInicial(undefined); }} focar={focarBoleta} tipoInicial={boletaTipoInicial} />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button className="btn flex items-center gap-1 text-term-cyan" onClick={() => setBoletaAberta(true)}>
            Abrir a boleta manual <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1">B</kbd>
          </button>
          <button className="btn text-term-cyan" onClick={() => { setBoletaTipoInicial("caixa"); setBoletaAberta(true); setFocarBoleta(true); }}>
            Aporte/Retirada
          </button>
        </div>
      )}

      {/* 3. Vencimentos que a B3 resolveu (exercício, pó) — evento, não execução no Profit */}
      <PainelVencimentos />

      {/* 4. A nota da corretora contra o livro */}
      <ReconciliacaoNota />

      {/* 5. Tabela de custos vigente */}
      <PainelCustos />

      {/* 6. Migração do navegador — uma vez */}
      <MigracaoLivro />

      {/* 7. A fita */}
      <UltimasBoletas />
    </>
  );
}
