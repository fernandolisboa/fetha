import { centavosSchema, type Centavos } from "@fetha/contracts";

import { recipeById } from "@/modules/strategies";

import type { ScoredSuggestionRow } from "./suggestions-repository";

export interface CalibrationLine {
  recipeId: string | null;
  recipeName: string | null;
  scored: number;
  claimed: number;
  held: number;
  pnl: Centavos;
}

export interface SuggestionCalibration {
  overall: CalibrationLine;
  byRecipe: CalibrationLine[];
}

function emptyLine(recipeId: string | null, recipeName: string | null): CalibrationLine {
  return { recipeId, recipeName, scored: 0, claimed: 0, held: 0, pnl: centavosSchema.parse(0) };
}

function add(line: CalibrationLine, row: ScoredSuggestionRow): CalibrationLine {
  return {
    ...line,
    scored: line.scored + 1,
    claimed: line.claimed + (row.claimHeld === null ? 0 : 1),
    held: line.held + (row.claimHeld === true ? 1 : 0),
    pnl: centavosSchema.parse(line.pnl + (row.pnlCentavos ?? 0)),
  };
}

// The journal's suggestion panel (docs/adr/0067): per recipe and overall, how many suggestions
// the engine scored, how many of those carried a claim it could judge and how many held, and the
// summed engine P&L of one lot each. Counting only; every figure summed is the engine's.
export function suggestionCalibration(rows: readonly ScoredSuggestionRow[]): SuggestionCalibration {
  let overall = emptyLine(null, null);
  const byRecipe = new Map<string, CalibrationLine>();
  for (const row of rows) {
    overall = add(overall, row);
    const line =
      byRecipe.get(row.recipeId) ??
      emptyLine(row.recipeId, recipeById(row.recipeId)?.definition.name ?? row.recipeId);
    byRecipe.set(row.recipeId, add(line, row));
  }
  return {
    overall,
    byRecipe: [...byRecipe.values()].sort(
      (a, b) => b.scored - a.scored || (a.recipeName ?? "").localeCompare(b.recipeName ?? ""),
    ),
  };
}
