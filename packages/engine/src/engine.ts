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
  ImpliedVolatilityIndexInput,
  IndicatorSeries,
  IndicatorsInput,
  MarketView,
  MarkToMarketInput,
  OperationPricing,
  PortfolioValuation,
  PriceOperationInput,
  ProposeSettlementInput,
  Provenance,
  Result,
  RunBacktestInput,
  Score,
  SettlementProposal,
} from "./api";
import { ENGINE_VERSION, pricingModels } from "./api";
import { capabilities as computeCapabilities } from "./internal/capabilities";
import { dataWindow as computeDataWindow } from "./internal/data-window";
import { evaluateStrategy as computeEvaluateStrategy } from "./internal/evaluate-strategy";
import { computeImpliedVolatilityIndex } from "./internal/implied-volatility-index";
import { computeIndicators } from "./internal/indicators-computation";
import { markToMarket as computeMarkToMarket } from "./internal/mark-to-market";
import { priceOperation as computePriceOperation } from "./internal/price-operation";
import { proposeSettlement as computeProposeSettlement } from "./internal/propose-settlement";
import { runBacktest as computeRunBacktest } from "./internal/run-backtest";
import { unsupportedThesisClaimKinds } from "./internal/vocabularies";

const pricingModelKind = pricingModels[0];
const thesisClaimKind = unsupportedThesisClaimKinds[0];

function unsupported<T>(vocabulary: CapabilityVocabulary, kind: string): Promise<Result<T>> {
  return Promise.resolve({ ok: false, error: { code: "unsupported", vocabulary, kind } });
}

// Every method that computes an artifact stamps it with the same four fields, read off the
// view it was handed (round 1 item 12): one place instead of five copies of the same object
// literal.
function provenanceBaseFor(
  view: MarketView,
): Pick<Provenance, "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"> {
  return {
    engineVersion: ENGINE_VERSION,
    pricingModel: pricingModelKind,
    dataVersion: view.dataVersion ?? null,
    datasetNotes: view.datasetNotes ?? [],
  };
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

  priceOperation(input: PriceOperationInput): Promise<Result<OperationPricing>> {
    return Promise.resolve(computePriceOperation(input, provenanceBaseFor(input.view)));
  },

  evaluateStrategy(input: EvaluateStrategyInput): Promise<Result<Evaluation>> {
    return Promise.resolve(computeEvaluateStrategy(input));
  },

  runBacktest(input: RunBacktestInput): Promise<Result<BacktestProgress>> {
    return Promise.resolve(computeRunBacktest(input));
  },

  markToMarket(input: MarkToMarketInput): Promise<Result<PortfolioValuation>> {
    return Promise.resolve(computeMarkToMarket(input, provenanceBaseFor(input.view)));
  },

  proposeSettlement(input: ProposeSettlementInput): Promise<Result<SettlementProposal>> {
    return Promise.resolve(computeProposeSettlement(input, provenanceBaseFor(input.view)));
  },

  score(): Promise<Result<Score>> {
    return unsupported("thesisClaims", thesisClaimKind);
  },

  impliedVolatilityIndex(
    input: ImpliedVolatilityIndexInput,
  ): Promise<Result<ImpliedVolatilityIndex>> {
    return Promise.resolve(
      computeImpliedVolatilityIndex(
        input.view,
        input.underlying,
        input.at,
        provenanceBaseFor(input.view),
      ),
    );
  },
};
