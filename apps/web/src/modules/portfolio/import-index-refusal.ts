import { isMarketIndex } from "@/modules/market-data";

import type { ImportedFill } from "./b3-import/parse-negotiation";

// A stock fill on a market index is never a real B3 fill (ADR-0062): the same refusal
// `recordFillAction` reports as `index_stock_leg`, applied here per imported row instead of
// failing the whole import over one row, and folded into the import's own `skipped` counts.
export function removeIndexStockLegs(fills: readonly ImportedFill[]): {
  importable: ImportedFill[];
  indexStockLegSkipped: number;
} {
  let indexStockLegSkipped = 0;
  const importable = fills.filter((fill) => {
    if (fill.assetClass === "stock" && isMarketIndex(fill.ticker)) {
      indexStockLegSkipped += 1;
      return false;
    }
    return true;
  });
  return { importable, indexStockLegSkipped };
}
