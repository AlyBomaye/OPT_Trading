"use client";

import { usePersistedState } from "@/lib/use-persisted-state";
import { useState } from "react";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Info, RotateCcw, Settings, ShieldAlert } from "lucide-react";
import { evaluateFlags, useFlagSettings, type PositionFlag, type FlagThresholds } from "@/lib/position-flags";
import type { ChainData, Position } from "@/lib/types";
import type { DividendEvent } from "@/lib/universe";

interface ActionFlagsProps {
  positions: Position[];
  chainCache: Record<string, ChainData>;
  divsByTicker: Record<string, DividendEvent[]>;
  capitalTotal: number;
  onSelectPosition?: (positionId: string) => void;
}

export function ActionFlags({
  positions,
  chainCache,
  divsByTicker,
  capitalTotal,
  onSelectPosition,
}: ActionFlagsProps) {
  // Leitura do storage após a montagem: no inicializador do useState o primeiro render do
  // cliente divergia do servidor e quebrava a hidratação.
  const [isOpen, setIsOpen] = usePersistedState<boolean>("carteira-flags-open", true);
  const [showSettings, setShowSettings] = useState(false);

  const { thresholds, setThreshold, reset } = useFlagSettings();

  const toggleOpen = () => setIsOpen((prev) => !prev);

  const flags = evaluateFlags(positions, chainCache, divsByTicker, capitalTotal, thresholds);

  const urgentes = flags.filter((f) => f.severity === "urgente").length;
  const atencao = flags.filter((f) => f.severity === "atencao").length;
  const info = flags.filter((f) => f.severity === "info").length;

  const handleFlagClick = (flag: PositionFlag) => {
    if (!flag.positionId) return;
    if (onSelectPosition) {
      onSelectPosition(flag.positionId);
    } else {
      const el = document.getElementById(`pos-row-${flag.positionId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("bg-term-cyan/20");
        setTimeout(() => el.classList.remove("bg-term-cyan/20"), 2500);
      }
    }
  };

  return (
    <div className="panel border-l-2 !border-l-term-gold relative">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-term-line/60">
        <div className="flex items-center gap-2 cursor-pointer select-none" onClick={toggleOpen}>
          <ShieldAlert size={16} className="text-term-gold" />
          <span className="font-mono font-bold text-xs text-term-gold">Ação do Dia</span>
          <span className="text-xxs font-mono text-term-dim">
            ({urgentes} urgentes · {atencao} atenção · {info} info)
          </span>
          <button className="text-term-dim hover:text-term-text p-0.5">
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="btn text-xxs p-1 text-term-dim hover:text-term-cyan"
            title="Configurar limiares de alarme"
            onClick={() => setShowSettings((s) => !s)}
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      {/* Popover de Configuração de Limiares */}
      {showSettings && (
        <div className="p-3 bg-term-panel2 border-b border-term-line space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-term-line/40 pb-1.5">
            <span className="font-bold text-term-cyan">Limiares de Alarme (Parâmetros)</span>
            <button
              onClick={reset}
              className="text-xxs text-term-dim hover:text-term-gold flex items-center gap-1"
              title="Restaurar valores padrão"
            >
              <RotateCcw size={10} /> Padrões
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xxs">
            <SettingInput
              label="Take Profit (%)"
              value={thresholds.takeProfitPct * 100}
              onChange={(v) => setThreshold("takeProfitPct", v / 100)}
            />
            <SettingInput
              label="Stop Long (%)"
              value={thresholds.stopLongPct * 100}
              onChange={(v) => setThreshold("stopLongPct", v / 100)}
            />
            <SettingInput
              label="Stop Short (x)"
              value={thresholds.stopShortMult}
              onChange={(v) => setThreshold("stopShortMult", v)}
            />
            <SettingInput
              label="Vencimento (DU)"
              value={thresholds.vencimentoDu}
              onChange={(v) => setThreshold("vencimentoDu", v)}
            />
            <SettingInput
              label="Rolar (DU)"
              value={thresholds.rolarDu}
              onChange={(v) => setThreshold("rolarDu", v)}
            />
            <SettingInput
              label="Rolar Captura (%)"
              value={thresholds.rolarCapturaPct * 100}
              onChange={(v) => setThreshold("rolarCapturaPct", v / 100)}
            />
            <SettingInput
              label="Risco ITM (DU)"
              value={thresholds.itmRiscoDu}
              onChange={(v) => setThreshold("itmRiscoDu", v)}
            />
            <SettingInput
              label="Delta Drift (x)"
              value={thresholds.deltaDriftMult}
              onChange={(v) => setThreshold("deltaDriftMult", v)}
            />
            <SettingInput
              label="Vol Crush (pts)"
              value={thresholds.volCrushPts}
              onChange={(v) => setThreshold("volCrushPts", v)}
            />
            <SettingInput
              label="Concentração Setor (%)"
              value={thresholds.concentracaoPct * 100}
              onChange={(v) => setThreshold("concentracaoPct", v / 100)}
            />
          </div>
        </div>
      )}

      {/* Conteúdo estendido */}
      {isOpen && (
        <div className="p-3 space-y-2">
          {flags.length === 0 ? (
            <div className="text-xs text-term-dim font-mono italic text-center py-1">
              Nenhuma ação pendente — book dentro dos parâmetros.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {flags.map((flag, idx) => {
                const colorClass =
                  flag.severity === "urgente"
                    ? "border-term-down/40 bg-term-down/5 text-term-down"
                    : flag.severity === "atencao"
                    ? "border-term-gold/40 bg-term-gold/5 text-term-gold"
                    : "border-term-line bg-term-panel2/40 text-term-dim";

                const dotColor =
                  flag.severity === "urgente"
                    ? "bg-term-down"
                    : flag.severity === "atencao"
                    ? "bg-term-gold"
                    : "bg-term-dim";

                return (
                  <div
                    key={idx}
                    onClick={() => handleFlagClick(flag)}
                    className={`p-2 rounded border text-xs flex items-center justify-between gap-3 cursor-pointer hover:border-term-cyan transition-colors ${colorClass}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                      <span className="font-mono font-bold text-term-cyan shrink-0">
                        {flag.opTicker ?? flag.ticker}
                      </span>
                      <span className="font-semibold text-term-text truncate">{flag.titulo}:</span>
                      <span className="text-term-dim text-xxs truncate hidden sm:inline">{flag.detalhe}</span>
                    </div>

                    <div className="text-xxs font-mono text-right shrink-0">
                      <span className="text-term-text italic">{flag.acao}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
}) {
  return (
    <div className="flex items-center justify-between bg-term-panel p-1.5 rounded border border-term-line">
      <span className="text-term-dim">{label}</span>
      <input
        type="number"
        value={Number(value.toFixed(1))}
        step={0.1}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="cell-input !w-14 text-right"
      />
    </div>
  );
}
