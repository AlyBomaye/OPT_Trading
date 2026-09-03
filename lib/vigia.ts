/**
 * WO-57 — a parte pura do vigia: o que merece aviso agora, e de quanto em quanto tempo olhar.
 *
 * O vigia (scripts/vigia.mjs) não avalia regra nenhuma — quem avalia é `/api/alertas`, com as
 * funções da tela. Aqui só se decide o que é NOVO (pela chave estável da WO-52) e o ritmo: acordar
 * de cinco em cinco minutos num sábado é gastar bateria para não dizer nada.
 */

import { sessionInfo, type SessionState } from "./session";
import type { Alerta, SeveridadeAlerta } from "./alertas";

const PESO: Record<SeveridadeAlerta, number> = { urgente: 0, atencao: 1, info: 2 };

/** Alertas que ainda não foram avisados hoje e têm severidade igual ou acima da mínima. */
export function alertasNovos(alertas: Alerta[], jaAvisados: Iterable<string>, severidadeMinima: SeveridadeAlerta = "atencao"): Alerta[] {
  const vistos = new Set(jaAvisados);
  const teto = PESO[severidadeMinima];
  return alertas.filter((a) => PESO[a.severidade] <= teto && !vistos.has(a.chave)).sort((a, b) => PESO[a.severidade] - PESO[b.severidade]);
}

/** Intervalos por estado da sessão, em minutos. */
export const INTERVALO_MIN: Record<SessionState, number> = {
  ABERTO: 5,
  PRE: 15,
  FECHADO: 60,
  FIM_DE_SEMANA: 360,
};

/** Quanto tempo dormir até a próxima checagem, em milissegundos, pelo estado da B3 agora. */
export function janelaDeVigia(agora = new Date()): { estado: SessionState; intervaloMs: number } {
  const estado = sessionInfo(agora).state;
  return { estado, intervaloMs: INTERVALO_MIN[estado] * 60_000 };
}
