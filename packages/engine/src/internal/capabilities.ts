import { ENGINE_VERSION } from "../api";
import type { Capabilities } from "../api";
import { implementedIndicatorKinds, implementedTimeframes } from "./vocabularies";

export function capabilities(): Capabilities {
  return {
    engineVersion: ENGINE_VERSION,
    timeframes: [...implementedTimeframes],
    indicators: [...implementedIndicatorKinds],
    strikeSelections: [],
    expirySelections: [],
    sizingRules: [],
    exitRules: [],
    adjustmentRules: [],
    thesisClaims: [],
    pricingModels: [],
  };
}
