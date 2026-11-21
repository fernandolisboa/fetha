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
