"use client";

/**
 * WO-47 §5.2 / §5.3 / §5.5 — a Carteira pensa por ESTRUTURA.
 *
 * A tabela de posições é por perna: uma trava aparece como duas linhas com P&L independentes,
 * uma Trava de Linha como quatro. O trader não opera pernas — opera estruturas — e as três coisas
 * que decidem a saída só existem no nível da estrutura:
 *
 *   · **% do lucro máximo atingido** — a régua dos 70% do método (WO-47 §5.1);
 *   · **DU restantes** — pinta em 10 (rolar) e 5 (fechar);
 *   · **o plano da entrada** — tese, alvo e regra de saída (WO-46), que eram gravados e sumiam.
 *
 * Cada linha expande para as pernas e para o plano. E "Fechar estrutura" fecha as N pernas numa
 * ação, com o preço de cada uma pré-preenchido pela marcação atual — editável, porque o que foi
 * executado na corretora pode ser outro. Preço sem marcação fica vazio, nunca zero.
 *
 * O agrupamento é o mesmo de `groupTrades` (`underlying|openedAt`) e o lucro máximo vem de
 * `strategyMetrics`, o mesmo que a Estratégia mostra ao montar. Nada é recalculado aqui.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers, Target, XCircle } from "lucide-react";
import clsx from "clsx";
import { markInfo, useMarket } from "@/store/market";
import { estruturasAbertas, type EstruturaAberta, type PositionFlag } from "@/lib/position-flags";
import { detectStrategy } from "@/lib/strategy-detect";
import { DU_ROLAR, DU_FECHAR, REALIZAR_PCT_LUCRO_MAXIMO, type Regime } from "@/lib/metodo";
import { fmtBRL, fmtDateBR, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import type { Position } from "@/lib/types";

type Motivo = NonNullable<Position["motivoSaida"]>;

const MOTIVOS: { valor: Motivo; rotulo: string }[] = [
  { valor: "alvo", rotulo: "Alvo (realização)" },
  { valor: "stop", rotulo: "Stop" },
  { valor: "regime", rotulo: "Tendência virou" },
  { valor: "vencimento", rotulo: "Rolagem / vencimento" },
  { valor: "manual", rotulo: "Manual" },
];

interface Props {
  flags: PositionFlag[];
  regimes: Record<string, { regime: Regime; observadoEm: string }>;
}

/** Dias úteis restantes: o menor `du` das pernas, descontado o que passou desde a abertura. */
function duRestantes(pernas: Position[]): number | null {
  const dus = pernas.map((p) => p.du ?? null).filter((d): d is number => d != null && d > 0);
  if (!dus.length) return null;
  const aberta = new Date(pernas[0].openedAt).getTime();
  const passados = Math.max(0, Math.round((Date.now() - aberta) / 86_400_000 * (252 / 365)));
  return Math.max(Math.min(...dus) - passados, 0);
}

/** Nome da estrutura pelo detector — que fala a língua do método desde o WO-47. */
function nomeDaEstrutura(pernas: Position[]): string {
  const d = detectStrategy(pernas);
  if (!d) return pernas.length === 1 ? "Perna única" : "Customizada";
  return d.name;
}

/** Motivo sugerido pela flag mais forte da estrutura — o trader confirma ou troca. */
function motivoSugerido(flags: PositionFlag[]): Motivo {
  const kinds = new Set(flags.map((f) => f.kind));
  if (kinds.has("REGIME_VIROU")) return "regime";
  if (kinds.has("TAKE_PROFIT")) return "alvo";
  if (kinds.has("STOP")) return "stop";
  if (kinds.has("ROLAR") || kinds.has("VENCIMENTO")) return "vencimento";
  return "manual";
}

export function PainelEstruturas({ flags, regimes }: Props) {
  const { positions, chainCache, selic, closeStructure } = useMarket();
  const [aberta, setAberta] = useState<string | null>(null);
  const [fechando, setFechando] = useState<string | null>(null);

  const estruturas = useMemo(
    () => estruturasAbertas(positions, chainCache, selic),
    [positions, chainCache, selic]
  );

  if (estruturas.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-title flex items-center gap-2">
        <Layers size={14} className="text-term-cyan" />
        <span className="font-bold">Estruturas abertas ({estruturas.length})</span>
        <span className="text-xxs text-term-dim font-normal ml-2">
          a régua dos {Math.round(REALIZAR_PCT_LUCRO_MAXIMO * 100)}% é sobre o lucro máximo da estrutura
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="border-b border-term-line">
            <tr>
              {["", "Ativo", "Estrutura", "Pernas", "P&L", "% do máx", "DU", "Alvo", "Regime", "Flags", ""].map((h, i) => (
                <th key={i} className="th text-right first:text-left [&:nth-child(2)]:text-left [&:nth-child(3)]:text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {estruturas.map((e) => (
              <LinhaEstrutura
                key={e.chave}
                e={e}
                flags={flags.filter((f) => e.pernas.some((p) => p.id === f.positionId))}
                regime={regimes[e.underlying] ?? null}
                chainCache={chainCache}
                expandida={aberta === e.chave}
                onToggle={() => setAberta(aberta === e.chave ? null : e.chave)}
                fechando={fechando === e.chave}
                onFechar={() => setFechando(fechando === e.chave ? null : e.chave)}
                onConfirmarFechamento={(fs, motivo) => {
                  closeStructure(fs, motivo);
                  setFechando(null);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinhaEstrutura({
  e,
  flags,
  regime,
  chainCache,
  expandida,
  onToggle,
  fechando,
  onFechar,
  onConfirmarFechamento,
}: {
  e: EstruturaAberta;
  flags: PositionFlag[];
  regime: { regime: Regime; observadoEm: string } | null;
  chainCache: Record<string, import("@/lib/types").ChainData>;
  expandida: boolean;
  onToggle: () => void;
  fechando: boolean;
  onFechar: () => void;
  onConfirmarFechamento: (fs: { id: string; closePrice: number }[], motivo: Motivo) => void;
}) {
  const lider = e.pernas[0];
  const nome = nomeDaEstrutura(e.pernas);
  const du = duRestantes(e.pernas);
  const spot = chainCache[e.underlying]?.spot ?? null;
  const alvo = lider.alvo ?? null;
  const distAlvo = alvo != null && spot != null && spot > 0 ? alvo / spot - 1 : null;
  const regimeMudou = regime != null && lider.regimeNaEntrada != null && regime.regime !== lider.regimeNaEntrada;

  const corDu = du == null ? "text-term-dim" : du <= DU_FECHAR ? "text-term-down" : du <= DU_ROLAR ? "text-term-gold" : "";
  const corMax =
    e.fracaoDoMaximo == null
      ? "text-term-dim"
      : e.fracaoDoMaximo >= REALIZAR_PCT_LUCRO_MAXIMO
        ? "text-term-up font-bold"
        : e.fracaoDoMaximo < 0
          ? "text-term-down"
          : "";

  return (
    <>
      <tr className="border-b border-term-line/40 hover:bg-term-panel2/50 transition-colors">
        <td className="td cursor-pointer" onClick={onToggle}>
          {expandida ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </td>
        <td className="td font-semibold text-term-cyan">{e.underlying}</td>
        <td className="td">{nome}</td>
        <td className="td text-right">{e.pernas.length}</td>
        <td className={clsx("td text-right font-semibold", pnlColor(e.pnl ?? 0))}>{fmtBRL(e.pnl)}</td>
        <td className={clsx("td text-right", corMax)} title={e.maxProfit != null ? `Lucro máximo ${fmtBRL(e.maxProfit)}` : "sem lucro máximo finito"}>
          {e.fracaoDoMaximo != null ? fmtPct(e.fracaoDoMaximo) : "—"}
        </td>
        <td className={clsx("td text-right", corDu)} title={`rolar a ${DU_ROLAR} du · fechar a ${DU_FECHAR} du`}>
          {du != null ? du : "—"}
        </td>
        <td className="td text-right" title={alvo != null ? `Alvo ${fmtNum(alvo, 2)}` : "sem alvo registrado"}>
          {alvo != null ? (
            <span className={clsx(distAlvo != null && Math.abs(distAlvo) < 0.01 && "text-term-up font-bold")}>
              {fmtNum(alvo, 2)}
              {distAlvo != null && <span className="text-term-dim text-xxs"> ({fmtPct(distAlvo)})</span>}
            </span>
          ) : "—"}
        </td>
        <td className={clsx("td text-right text-xxs", regimeMudou ? "text-term-down font-bold" : "text-term-dim")}
            title={regimeMudou ? `Entrou em ${lider.regimeNaEntrada}; agora ${regime?.regime}` : undefined}>
          {regime ? regime.regime : lider.regimeNaEntrada ?? "—"}
          {regimeMudou && " ⚠"}
        </td>
        <td className="td text-right whitespace-nowrap text-xxs">
          {flags.length ? (
            <span className={flags.some((f) => f.severity === "urgente") ? "text-term-down" : "text-term-gold"}>
              {Array.from(new Set(flags.map((f) => f.kind))).join(" · ")}
            </span>
          ) : <span className="text-term-dim">—</span>}
        </td>
        <td className="td text-right whitespace-nowrap">
          <button className="text-term-gold hover:opacity-70" title="Fechar a estrutura inteira" onClick={onFechar}>
            <XCircle size={13} />
          </button>
        </td>
      </tr>

      {expandida && (
        <tr className="bg-term-panel2/30">
          <td colSpan={11} className="px-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xxs">
              <div>
                <div className="text-term-dim uppercase tracking-wider mb-1">Pernas</div>
                {e.pernas.map((p) => {
                  const m = markInfo(p, chainCache);
                  return (
                    <div key={p.id} className="flex justify-between gap-2 font-mono">
                      <span>
                        <span className={p.side === 1 ? "text-term-up" : "text-term-down"}>{p.side === 1 ? "C" : "V"}</span>{" "}
                        {p.kind === "STOCK" ? "ação" : `${p.type} ${fmtNum(p.strike ?? 0)} ${p.expiry ? fmtDateBR(p.expiry) : ""}`} × {p.qty}
                      </span>
                      <span className="text-term-dim">
                        {fmtBRL(p.price)} → {m.price != null ? fmtBRL(m.price) : "sem marca"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-1">
                <div className="text-term-dim uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Target size={10} /> O plano da entrada
                </div>
                <div><b>Tese:</b> {lider.tese ?? <span className="text-term-dim">não registrada</span>}</div>
                <div><b>Regra de saída:</b> {lider.regraSaida ?? <span className="text-term-dim">não registrada</span>}</div>
                <div><b>Regime na entrada:</b> {lider.regimeNaEntrada ?? <span className="text-term-dim">não capturado</span>}</div>
              </div>
            </div>
          </td>
        </tr>
      )}

      {fechando && (
        <tr className="bg-term-gold/5">
          <td colSpan={11} className="px-4 py-3">
            <FormularioFechamento
              pernas={e.pernas}
              chainCache={chainCache}
              motivoInicial={motivoSugerido(flags)}
              onCancelar={onFechar}
              onConfirmar={onConfirmarFechamento}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function FormularioFechamento({
  pernas,
  chainCache,
  motivoInicial,
  onCancelar,
  onConfirmar,
}: {
  pernas: Position[];
  chainCache: Record<string, import("@/lib/types").ChainData>;
  motivoInicial: Motivo;
  onCancelar: () => void;
  onConfirmar: (fs: { id: string; closePrice: number }[], motivo: Motivo) => void;
}) {
  const [motivo, setMotivo] = useState<Motivo>(motivoInicial);
  // Pré-preenche com a marcação atual; sem marcação fica VAZIO, nunca zero (WO-30).
  const [precos, setPrecos] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      pernas.map((p) => {
        const m = markInfo(p, chainCache).price;
        return [p.id, m != null ? m.toFixed(2) : ""];
      })
    )
  );
  useEffect(() => setMotivo(motivoInicial), [motivoInicial]);

  const parse = (v: string) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const faltando = pernas.filter((p) => parse(precos[p.id] ?? "") == null);

  return (
    <div className="space-y-2 text-xxs">
      <div className="font-semibold">Fechar a estrutura — {pernas.length} perna(s)</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        {pernas.map((p) => (
          <label key={p.id} className="flex items-center justify-between gap-2 font-mono">
            <span>
              <span className={p.side === 1 ? "text-term-up" : "text-term-down"}>{p.side === 1 ? "C" : "V"}</span>{" "}
              {p.kind === "STOCK" ? "ação" : `${p.type} ${fmtNum(p.strike ?? 0)}`} × {p.qty}
            </span>
            <span className="flex items-center gap-1">
              <span className="text-term-dim">R$</span>
              <input
                value={precos[p.id] ?? ""}
                onChange={(ev) => setPrecos({ ...precos, [p.id]: ev.target.value })}
                inputMode="decimal"
                placeholder="sem marca"
                className={clsx(
                  "w-20 bg-term-panel2 border rounded px-2 py-1 text-xxs font-mono text-right outline-none focus:border-term-cyan",
                  parse(precos[p.id] ?? "") == null ? "border-term-down" : "border-term-line"
                )}
              />
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-term-dim">Motivo:</span>
        {MOTIVOS.map((m) => (
          <button
            key={m.valor}
            onClick={() => setMotivo(m.valor)}
            className={clsx(
              "px-2 py-0.5 rounded border font-mono",
              motivo === m.valor ? "bg-term-cyan/15 border-term-cyan/50 text-term-cyan" : "bg-term-panel2 border-term-line text-term-dim"
            )}
          >
            {m.rotulo}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          className="btn btn-primary disabled:opacity-50"
          disabled={faltando.length > 0}
          title={faltando.length ? "Informe o preço das pernas sem marcação" : undefined}
          onClick={() => onConfirmar(pernas.map((p) => ({ id: p.id, closePrice: parse(precos[p.id] ?? "")! })), motivo)}
        >
          Confirmar fechamento
        </button>
        <button className="btn text-term-dim" onClick={onCancelar}>Cancelar</button>
        {faltando.length > 0 && <span className="text-term-gold">{faltando.length} perna(s) sem preço</span>}
      </div>
    </div>
  );
}
