import type {
  BacktestProgress,
  Capabilities,
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
import { capabilities as computeCapabilities } from "./internal/capabilities";
import { dataWindow as computeDataWindow } from "./internal/data-window";
import { computeIndicators } from "./internal/indicators-computation";

function notImplemented<T>(): Promise<Result<T>> {
  return Promise.resolve({
    ok: false,
    error: { code: "invalid_input", path: "", message: "not implemented" },
  });
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
    return notImplemented();
  },

  evaluateStrategy(): Promise<Result<Evaluation>> {
    return notImplemented();
  },

  runBacktest(): Promise<Result<BacktestProgress>> {
    return notImplemented();
  },

  markToMarket(): Promise<Result<PortfolioValuation>> {
    return notImplemented();
  },

  proposeSettlement(): Promise<Result<SettlementProposal>> {
    return notImplemented();
  },

  score(): Promise<Result<Score>> {
    return notImplemented();
  },

  impliedVolatilityIndex(): Promise<Result<ImpliedVolatilityIndex>> {
    return notImplemented();
  },
};
