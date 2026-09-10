import type { LegTemplate, OperationLeg } from "@fetha/contracts";
import type { LegValuation } from "@fetha/engine";
import type { ChainSeries } from "@/modules/market-data";

// One editable row in the builder: the structure's template (role, side,
// ratio, the strike rank it stands for) paired with the concrete leg the
// user has picked (or not yet), and the engine's valuation for it once the
// operation has been priced.
export interface BuilderLeg {
  template: LegTemplate;
  leg: OperationLeg | null;
  valuation: LegValuation | null;
}

export type { ChainSeries };
