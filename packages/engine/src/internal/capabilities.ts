import { ENGINE_VERSION, pricingModels } from "../api";
import type { Capabilities } from "../api";
import {
  implementedExitRuleKinds,
  implementedExpirySelectionKinds,
  implementedIndicatorKinds,
  implementedSizingRuleKinds,
  implementedStrikeSelectionKinds,
  implementedTimeframes,
} from "./vocabularies";

export function capabilities(): Capabilities {
  return {
    engineVersion: ENGINE_VERSION,
    timeframes: [...implementedTimeframes],
    indicators: [...implementedIndicatorKinds],
    strikeSelections: [...implementedStrikeSelectionKinds],
    expirySelections: [...implementedExpirySelectionKinds],
    sizingRules: [...implementedSizingRuleKinds],
    exitRules: [...implementedExitRuleKinds],
    adjustmentRules: [],
    thesisClaims: [],
    pricingModels: [...pricingModels],
  };
}
