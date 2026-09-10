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
  MarkToMarketInput,
  OperationPricing,
  PortfolioValuation,
  PriceOperationInput,
  ProposeSettlementInput,
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
    return Promise.resolve(
      computePriceOperation(input, {
        engineVersion: ENGINE_VERSION,
        pricingModel: pricingModelKind,
        dataVersion: input.view.dataVersion ?? null,
        datasetNotes: input.view.datasetNotes ?? [],
      }),
    );
  },

  evaluateStrategy(input: EvaluateStrategyInput): Promise<Result<Evaluation>> {
    return Promise.resolve(computeEvaluateStrategy(input));
  },

  runBacktest(input: RunBacktestInput): Promise<Result<BacktestProgress>> {
    return Promise.resolve(computeRunBacktest(input));
  },

  markToMarket(input: MarkToMarketInput): Promise<Result<PortfolioValuation>> {
    return Promise.resolve(
      computeMarkToMarket(input, {
        engineVersion: ENGINE_VERSION,
        pricingModel: pricingModelKind,
        dataVersion: input.view.dataVersion ?? null,
        datasetNotes: input.view.datasetNotes ?? [],
      }),
    );
  },

  proposeSettlement(input: ProposeSettlementInput): Promise<Result<SettlementProposal>> {
    return Promise.resolve(
      computeProposeSettlement(input, {
        engineVersion: ENGINE_VERSION,
        pricingModel: pricingModelKind,
        dataVersion: input.view.dataVersion ?? null,
        datasetNotes: input.view.datasetNotes ?? [],
      }),
    );
  },

  score(): Promise<Result<Score>> {
    return unsupported("thesisClaims", thesisClaimKind);
  },

  impliedVolatilityIndex(
    input: ImpliedVolatilityIndexInput,
  ): Promise<Result<ImpliedVolatilityIndex>> {
    return Promise.resolve(
      computeImpliedVolatilityIndex(input.view, input.underlying, input.at, {
        engineVersion: ENGINE_VERSION,
        pricingModel: pricingModelKind,
        dataVersion: input.view.dataVersion ?? null,
        datasetNotes: input.view.datasetNotes ?? [],
      }),
    );
  },
};
