import { MAX_LOTS_SEARCHED } from "./sizing";

// The lot stepper's own bounds (ticket #380): never below one lot, never above the same cap
// `chooseLotSize` already searches up to (`sizing.ts`) — a user-chosen lot count the engine was
// never even asked to size past would be a number this screen could not have shown during
// auto-sizing either.
export function clampLots(lots: number): number {
  return Math.max(1, Math.min(MAX_LOTS_SEARCHED, Math.round(lots)));
}

export function stepLots(current: number, direction: 1 | -1): number {
  return clampLots(current + direction);
}

// Whether a lot count's own max loss breaches the risk limit (ticket #380, "respecting the risk
// limit; show the plain warning when over"): the stepper itself never blocks on this — the
// engine's own `limitBreaches` already carries the same fact for the screen's existing
// `RiskNotice` to render — this is only what decides whether that warning shows for a given
// preview, so a test can assert it without a full `OperationPricing` fixture.
export function overRiskLimit(
  maxLossCentavos: number | "unbounded",
  riskLimitCentavos: number,
): boolean {
  if (maxLossCentavos === "unbounded") return riskLimitCentavos >= 0;
  return maxLossCentavos > riskLimitCentavos;
}
