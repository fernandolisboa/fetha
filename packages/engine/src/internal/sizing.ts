import Decimal from "decimal.js";
import type { Centavos, DecimalString, SizingRule } from "@fetha/contracts";
import { CENTAVOS_PER_REAL, parseDecimal } from "./decimal";

export type StockSizingLeg = { side: "buy" | "sell"; ratio: number };

export type StockSizingInput = {
  sizing: SizingRule;
  declaredCapital: Centavos | null;
  legs: readonly StockSizingLeg[];
  price: DecimalString;
};

export type StockSizingReason = "no_declared_capital" | "unbounded_max_loss" | "zero_units";

export type StockSizingResult =
  { ok: true; units: number } | { ok: false; detail: StockSizingReason };

export function sizeStockEntry(input: StockSizingInput): StockSizingResult {
  if (input.sizing.kind === "fixed_risk" && input.legs.some((leg) => leg.side === "sell")) {
    return { ok: false, detail: "unbounded_max_loss" };
  }
  if (input.declaredCapital === null) {
    return { ok: false, detail: "no_declared_capital" };
  }

  const priceCentavos = parseDecimal(input.price).mul(CENTAVOS_PER_REAL);
  const perUnitCentavos = input.legs.reduce(
    (acc, leg) => acc.add(priceCentavos.mul(leg.ratio)),
    new Decimal(0),
  );
  if (perUnitCentavos.lte(0)) {
    return { ok: false, detail: "zero_units" };
  }
  const budgetCentavos = new Decimal(input.declaredCapital).mul(
    parseDecimal(input.sizing.fraction),
  );
  const units = budgetCentavos.div(perUnitCentavos).floor().toNumber();

  return units >= 1 ? { ok: true, units } : { ok: false, detail: "zero_units" };
}
