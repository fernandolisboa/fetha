import { quantitySchema, type LegTemplate, type Structure, type Ticker } from "@fetha/contracts";
import type { LegInput } from "@fetha/engine";

export type OptionLegTemplate = Extract<LegTemplate, { role: "call" | "put" }>;

// The drag-to-adjust screen's own edit of one option leg's listed series (ticket #380): a
// ticker only — role, side and quantity always come from the structure's own template, never
// from the client, so a plan can never be saved under a role, side or ratio the recipe did not
// ask for. Ordered the same way the template's own non-stock legs are (`optionLegsOf`).
export interface AdjustedLegInput {
  ticker: Ticker;
}

// The structure's own legs with a chosen role (`stock` never adjusted: it has no strike, always
// the plan's own underlying), in template order — the same order a client's `legs` array must
// line up against position by position.
export function optionLegsOf(structure: Structure): OptionLegTemplate[] {
  return structure.legs.filter((leg): leg is OptionLegTemplate => leg.role !== "stock");
}

// Rebuilds every leg of the structure from its own template (ticket #380, the core identity and
// ratio fix): role, side and quantity (`ratio * lots * 100`, ADR-0067's standard lot) always
// come from `structure.legs`, never recomputed as a flat `lots * 100` the way a role+side edit
// once did — a 1/2/1 butterfly keeps its 1/2/1 ratio under every edit. Only the listed ticker of
// each non-stock leg is the caller's own (already validated against the same template by
// `validateStructuralAdjustment`); a stock leg's ticker is always the plan's own underlying.
// Null when `optionTickers` does not have exactly one entry per non-stock template leg.
export function legsFromTemplate(
  structure: Structure,
  underlying: Ticker,
  optionTickers: readonly Ticker[],
  lots: number,
): LegInput[] | null {
  const optionLegs = optionLegsOf(structure);
  if (optionTickers.length !== optionLegs.length) return null;

  let cursor = 0;
  const legs: LegInput[] = [];
  for (const template of structure.legs) {
    const quantity = quantitySchema.parse(template.ratio * lots * 100);
    if (template.role === "stock") {
      legs.push({ role: "stock", side: template.side, ticker: underlying, quantity });
      continue;
    }
    const ticker = optionTickers[cursor];
    cursor += 1;
    if (!ticker) return null;
    legs.push({ role: template.role, side: template.side, ticker, quantity });
  }
  return legs;
}
