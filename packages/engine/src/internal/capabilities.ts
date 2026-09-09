import { ENGINE_VERSION } from "../api";
import type { Capabilities } from "../api";
import {
  implementedExitRuleKinds,
  implementedIndicatorKinds,
  implementedSizingRuleKinds,
  implementedTimeframes,
} from "./vocabularies";

export function capabilities(): Capabilities {
  return {
    engineVersion: ENGINE_VERSION,
    timeframes: [...implementedTimeframes],
    indicators: [...implementedIndicatorKinds],
    strikeSelections: [],
    expirySelections: [],
    sizingRules: [...implementedSizingRuleKinds],
    exitRules: [...implementedExitRuleKinds],
    adjustmentRules: [],
    thesisClaims: [],
    pricingModels: [],
  };
}
