"use client";

/**
 * WO-46 §E.2 — as 3 perguntas do método viram a porta do "Abrir posição".
 *
 * Os campos `tese`, `alvo` e `regraSaida` existem em `Position` desde o WO-44 e nenhuma tela os
 * preenchia. O momento certo de perguntar é **antes** de a posição existir: perguntar depois vira
 * diário, e diário é justificativa. Perguntar antes é disciplina — é o único instante em que a
 * resposta ainda pode mudar a decisão.
 *
 * Duas escolhas deliberadas:
 *
 * 1. **A tese é obrigatória; alvo e regra de saída, não.** Bloquear as três transformaria o
 *    formulário num pedágio a ser preenchido com lixo. Uma tese em branco, por outro lado, é a
 *    própria ausência da operação — e o método é explícito sobre isso.
 * 2. **O regime da entrada é capturado, não digitado.** Vem da marcação vigente em `/api/regime`.
 *    Pedir ao trader que redigite o que ele já marcou convida à divergência entre os dois.
 */

import { useEffect, useState } from "react";
import { Save, X, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { REALIZAR_PCT_LUCRO_MAXIMO, DU_ROLAR, DU_FECHAR, type Regime } from "@/lib/metodo";
import { fmtBRL } from "@/lib/format";

export interface DadosAbertura {
  tese: string;
  /** Preço onde a tese para. Número, não texto: é o que vira ordem limitada. */
  alvo: number | undefined;
  regraSaida: string;
  regimeNaEntrada: Regime | undefined;
}

interface Props {
  ticker: string;
  /** Preço-alvo já calculado pela análise de P&L, para virar sugestão de alvo. */
  precoAlvoSugerido: number | null;
  lucroAlvoSugerido: number | null;
  onConfirmar: (d: DadosAbertura) => void;
  onCancelar: () => void;
}

export function FormularioAbertura({
  ticker,
  precoAlvoSugerido,
  lucroAlvoSugerido,
  onConfirmar,
  onCancelar,
}: Props) {
  const [tese, setTese] = useState("");
  const [alvo, setAlvo] = useState("");
  const [regraSaida, setRegraSaida] = useState("");
  const [regime, setRegime] = useState<Regime | null>(null);
  const [tentou, setTentou] = useState(false);

  // O regime vem da marcação, não do teclado.
  useEffect(() => {
    let vivo = true;
    fetch(`/api/regime?ticker=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j?.vigente?.regime) setRegime(j.vigente.regime as Regime);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [ticker]);

  // O alvo já vem calculado: é o preço em que a estrutura atinge 70% do lucro máximo. O trader
  // edita se a leitura dele de suporte/resistência disser outra coisa — mas não parte do zero.
  useEffect(() => {
    if (alvo === "" && precoAlvoSugerido != null) setAlvo(precoAlvoSugerido.toFixed(2));
  }, [alvo, precoAlvoSugerido]);

  useEffect(() => {
    if (regraSaida === "") {
      setRegraSaida(
        `Realizo em ${Math.round(REALIZAR_PCT_LUCRO_MAXIMO * 100)}% do lucro máximo; rolo a ${DU_ROLAR} du do vencimento; fecho a ${DU_FECHAR} du; saio se a tendência virar.`
      );
    }
  }, [regraSaida]);

  const teseVazia = tese.trim().length === 0;

  const confirmar = () => {
    setTentou(true);
    if (teseVazia) return;
    const alvoNum = Number(alvo.replace(",", "."));
    onConfirmar({
      tese: tese.trim(),
      alvo: Number.isFinite(alvoNum) && alvoNum > 0 ? alvoNum : undefined,
      regraSaida: regraSaida.trim(),
      regimeNaEntrada: regime ?? undefined,
    });
  };

  return (
    <div className="panel border-l-2 !border-l-term-gold">
      <div className="panel-title flex items-center justify-between gap-2">
        <span className="font-bold">Antes de abrir — as 3 perguntas do método</span>
        {regime && (
          <span className="tag bg-term-panel2 text-term-dim whitespace-nowrap">
            regime marcado: {regime}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2.5">
        <Campo
          rotulo="1. Qual é a tese?"
          dica="O que você acha que vai acontecer, e por quê. Se não couber aqui, provavelmente não existe."
          erro={tentou && teseVazia ? "A tese é o único campo obrigatório — sem ela não há operação." : null}
        >
          <textarea
            value={tese}
            onChange={(e) => setTese(e.target.value)}
            rows={2}
            autoFocus
            placeholder={`Ex.: ${ticker} sustenta a tendência de alta após o balanço, com IV ainda baixa.`}
            className={clsx(
              "w-full bg-term-panel2 border rounded px-2 py-1.5 text-xxs text-term-text outline-none resize-y",
              tentou && teseVazia ? "border-term-down" : "border-term-line focus:border-term-cyan"
            )}
          />
        </Campo>

        <Campo
          rotulo="2. Qual é o alvo?"
          dica="O preço do ativo onde a tese para. Já vem com o preço que realiza 70% do lucro máximo — edite se o seu suporte ou resistência disser outra coisa."
        >
          <div className="flex items-center gap-2">
            <span className="text-xxs text-term-dim font-mono">{ticker} a R$</span>
            <input
              value={alvo}
              onChange={(e) => setAlvo(e.target.value)}
              inputMode="decimal"
              className="w-24 bg-term-panel2 border border-term-line rounded px-2 py-1.5 text-xxs font-mono text-term-text outline-none focus:border-term-cyan"
            />
            {lucroAlvoSugerido != null && (
              <span className="text-xxs text-term-dim">
                realiza {fmtBRL(lucroAlvoSugerido)} ({Math.round(REALIZAR_PCT_LUCRO_MAXIMO * 100)}% do máximo)
              </span>
            )}
          </div>
        </Campo>

        <Campo rotulo="3. Qual é a regra de saída?" dica="Como a operação termina — nos dois sentidos. Já vem com as quatro regras do método.">
          <textarea
            value={regraSaida}
            onChange={(e) => setRegraSaida(e.target.value)}
            rows={2}
            className="w-full bg-term-panel2 border border-term-line rounded px-2 py-1.5 text-xxs text-term-text outline-none resize-y focus:border-term-cyan"
          />
        </Campo>

        {regime == null && (
          <div className="flex items-start gap-2 text-xxs text-term-dim">
            <TriangleAlert size={12} className="shrink-0 mt-0.5 text-term-gold" />
            <span>
              Sem regime marcado para {ticker}: a posição será gravada sem a leitura de tendência da
              entrada, e depois não dá para conferir se a leitura estava certa. Marque na aba
              Estratégia, modo Contexto.
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button className="btn btn-primary flex items-center gap-1" onClick={confirmar}>
            <Save size={12} /> Abrir posição
          </button>
          <button className="btn flex items-center gap-1 text-term-dim" onClick={onCancelar}>
            <X size={12} /> Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({
  rotulo,
  dica,
  erro,
  children,
}: {
  rotulo: string;
  dica: string;
  erro?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xxs font-semibold mb-0.5">{rotulo}</div>
      <div className="text-xxs text-term-dim mb-1 leading-relaxed">{dica}</div>
      {children}
      {erro && <div className="text-xxs text-term-down mt-0.5">{erro}</div>}
    </div>
  );
}
