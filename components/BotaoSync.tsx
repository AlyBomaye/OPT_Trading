"use client";

import { useState } from "react";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { fmtDateBR } from "@/lib/format";

/**
 * WO-38 — Botão de atualização completa das fontes.
 *
 * Faz na tela o que `npm run dados:sync` faz no terminal: força a rebusca das fontes pesadas e
 * mostra, por fonte, a DATA DO DADO e o que veio.
 *
 * Duas decisões que valem explicar:
 *
 * 1. O relatório mostra a data do dado, não "atualizado com sucesso". Depois de sincronizar, o
 *    Focus continua sendo de dias atrás — é assim que ele é publicado. Dizer "atualizado" sem
 *    dizer "de quando" reintroduziria a confusão que o WO-30 eliminou.
 * 2. Fonte que falha não vira erro global. A tela mostra o que veio e nomeia o que faltou, na
 *    mesma disciplina do resto da plataforma.
 */

interface ResultadoFonte {
  fonte: string;
  ok: boolean;
  dataDoDado: string | null;
  resumo: string;
  notas: string[];
  duracaoMs: number;
}

interface Relatorio {
  resultados: ResultadoFonte[];
  duracaoTotalMs: number;
  concluidoEm: string;
  todasOk: boolean;
}

function fmtDuracao(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function BotaoSync() {
  const [rodando, setRodando] = useState(false);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  const sincronizar = async () => {
    setRodando(true);
    setErro(null);
    setAberto(true);
    try {
      const res = await fetch("/api/dados-sync", {
        method: "POST",
        // Teto folgado: o CSV do Tesouro tem 13,7 MB e pode demorar em rede ruim.
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`servidor respondeu ${res.status}`);
      const j: Relatorio = await res.json();
      setRelatorio(j);
      // Sem recarregamento automático: as páginas buscam os dados na montagem, então recarregar é
      // necessário para VER o dado novo — mas fazer isso sozinho apagaria o relatório que o
      // usuário acabou de pedir. Quem decide quando recarregar é ele, no botão abaixo.
    } catch (e: any) {
      setErro(
        /timeout|abort/i.test(String(e?.message))
          ? "A sincronização passou de 4 minutos e foi interrompida. As fontes que já responderam estão em cache."
          : `Não foi possível sincronizar: ${e?.message ?? "erro desconhecido"}`
      );
    } finally {
      setRodando(false);
    }
  };

  return (
    <div className="px-3 py-2 border-t border-term-line">
      <button
        onClick={sincronizar}
        disabled={rodando}
        title="Rebusca curvas do Tesouro, Boletim Focus, macro, notícias e posições da B3 — o mesmo que npm run dados:sync"
        className="w-full flex items-center justify-center gap-1.5 text-xxs font-mono py-1.5 rounded border border-term-line bg-term-panel2 text-term-dim hover:text-term-cyan hover:border-term-cyan/50 disabled:opacity-60 transition-colors"
      >
        <RefreshCw size={12} className={clsx(rodando && "animate-spin")} />
        {rodando ? "Sincronizando…" : "Atualizar dados"}
      </button>

      {aberto && (erro || relatorio) && (
        <div className="mt-2 text-xxs font-mono space-y-1">
          {erro && (
            <div className="text-red-400 bg-red-500/10 border border-red-500/30 rounded px-1.5 py-1 leading-relaxed">
              {erro}
            </div>
          )}

          {relatorio && (
            <>
              {relatorio.resultados.map((r) => (
                <div key={r.fonte} className="flex items-start gap-1 leading-tight" title={r.notas.join(" · ") || undefined}>
                  {r.ok ? (
                    <Check size={10} className="text-term-up mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle size={10} className="text-term-gold mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-term-text truncate">{r.fonte}</div>
                    <div className="text-term-dim truncate">
                      {/* A data do dado é o que importa — não a de quando se buscou. */}
                      {r.dataDoDado ? `dado de ${fmtDateBR(r.dataDoDado)}` : "sem data informada"} · {fmtDuracao(r.duracaoMs)}
                    </div>
                  </div>
                </div>
              ))}
              <div className="text-term-dim pt-1 border-t border-term-line/40">
                {relatorio.todasOk ? "tudo sincronizado" : "concluído com pendências"} em{" "}
                {fmtDuracao(relatorio.duracaoTotalMs)}
              </div>
              <button
                onClick={() => window.location.reload()}
                className="w-full text-xxs font-mono py-1 rounded border border-term-cyan/40 text-term-cyan hover:bg-term-cyan/10 transition-colors"
                title="As abas leem os dados ao abrir — recarregue para ver os números novos na tela"
              >
                Recarregar tela
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
