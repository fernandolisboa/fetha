import type {
  BacktestProgress,
  Capabilities,
  CapabilityVocabulary,
  DataWindow,
  DataWindowInput,
  Engine,
  EvaluateStrategyInput,
  Evaluation,
  ImpliedVolatilityIndex,
  IndicatorSeries,
  IndicatorsInput,
  OperationPricing,
  PortfolioValuation,
  Result,
  RunBacktestInput,
  Score,
  SettlementProposal,
} from "./api";
import { pricingModels } from "./api";
import { capabilities as computeCapabilities } from "./internal/capabilities";
import { dataWindow as computeDataWindow } from "./internal/data-window";
import { evaluateStrategy as computeEvaluateStrategy } from "./internal/evaluate-strategy";
import { computeIndicators } from "./internal/indicators-computation";
import { unsupportedThesisClaimKinds } from "./internal/vocabularies";

const pricingModelKind = pricingModels[0];
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

  evaluateStrategy(input: EvaluateStrategyInput): Promise<Result<Evaluation>> {
    return Promise.resolve(computeEvaluateStrategy(input));
  },

  runBacktest(input: RunBacktestInput): Promise<Result<BacktestProgress>> {
    return unsupported("sizingRules", input.config.strategy.definition.sizing.kind);
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
