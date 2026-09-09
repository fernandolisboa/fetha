import type {
  BacktestProgress,
  Capabilities,
  CapabilityVocabulary,
  DataWindow,
  DataWindowInput,
  Engine,
  Evaluation,
  ImpliedVolatilityIndex,
  IndicatorSeries,
  IndicatorsInput,
  OperationPricing,
  PortfolioValuation,
  Result,
  Score,
  SettlementProposal,
} from "./api";
import { pricingModels } from "./api";
import { capabilities as computeCapabilities } from "./internal/capabilities";
import { dataWindow as computeDataWindow } from "./internal/data-window";
import { computeIndicators } from "./internal/indicators-computation";
import { unsupportedSizingRuleKinds, unsupportedThesisClaimKinds } from "./internal/vocabularies";

const pricingModelKind = pricingModels[0];
const sizingRuleKind = unsupportedSizingRuleKinds[0];
const thesisClaimKind = unsupportedThesisClaimKinds[0];

function unsupported<T>(vocabulary: CapabilityVocabulary, kind: string): Promise<Result<T>> {
  return Promise.resolve({ ok: false, error: { code: "unsupported", vocabulary, kind } });
}

export const engine: Engine = {
  capabilities(): Capabilities {
    return computeCapabilities();
  },

  dataWindow(input: DataWindowInput): DataWindow {
    return computeDataWindow(input);
  },

  indicators(input: IndicatorsInput): Promise<Result<IndicatorSeries>> {
    return Promise.resolve(computeIndicators(input));
  },

  priceOperation(): Promise<Result<OperationPricing>> {
    return unsupported("pricingModels", pricingModelKind);
  },

  evaluateStrategy(): Promise<Result<Evaluation>> {
    return unsupported("sizingRules", sizingRuleKind);
  },

  runBacktest(): Promise<Result<BacktestProgress>> {
    return unsupported("sizingRules", sizingRuleKind);
  },

  markToMarket(): Promise<Result<PortfolioValuation>> {
    return unsupported("pricingModels", pricingModelKind);
  },

  proposeSettlement(): Promise<Result<SettlementProposal>> {
    return unsupported("pricingModels", pricingModelKind);
  },

  score(): Promise<Result<Score>> {
    return unsupported("thesisClaims", thesisClaimKind);
  },

  impliedVolatilityIndex(): Promise<Result<ImpliedVolatilityIndex>> {
    return unsupported("pricingModels", pricingModelKind);
  },
};
