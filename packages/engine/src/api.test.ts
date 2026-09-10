import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  Centavos,
  DecimalString,
  LegTemplate,
  Quantity,
  SessionDate,
  SignedQuantity,
} from "@fetha/contracts";
import {
  backtestProgressStatuses,
  candleForms,
  capabilityVocabularies,
  closeReasonKinds,
  decisionKinds,
  decisionOriginKinds,
  ENGINE_VERSION,
  engineErrorCodes,
  evaluationOutcomes,
  exerciseStyles,
  fillSources,
  impliedVolatilityIndexMethods,
  limitModes,
  macroSeriesKinds,
  marketViewCollections,
  missedEntryReasons,
  noteCodes,
  optionRights,
  priceSources,
  pricingModels,
  scoreSubjects,
  settlementOutcomes,
  signalKinds,
  simulatedOperationStatuses,
  truncationReasons,
  unsizeableReasons,
  volatilitySources,
  type BacktestProgress,
  type BacktestProgressStatus,
  type Capabilities,
  type CapabilityVocabulary,
  type CandleForm,
  type CloseReasonKind,
  type DataWindow,
  type DecisionKind,
  type DecisionOriginKind,
  type Engine,
  type EngineErrorCode,
  type Evaluation,
  type EvaluationOutcome,
  type ExerciseStyle,
  type Fill,
  type FillSource,
  type ImpliedVolatilityIndex,
  type ImpliedVolatilityIndexMethod,
  type IndicatorSeries,
  type LegRole,
  type LegSettlement,
  type LimitMode,
  type MacroSeriesKind,
  type MarketView,
  type MarketViewCollection,
  type MissedEntryReason,
  type NoteCode,
  type Operation,
  type OperationPricing,
  type OptionRight,
  type PortfolioValuation,
  type Position,
  type PriceSource,
  type PricingModel,
  type ProposeSettlementInput,
  type Result,
  type Score,
  type ScoreInput,
  type ScoreSubject,
  type SettlementOutcome,
  type SettlementProposal,
  type Side,
  type SignalKind,
  type SimulatedOperation,
  type SimulatedOperationStatus,
  type TruncationReason,
  type UnsizeableReason,
  type VolatilitySource,
} from "./api";

type EngineMethod = keyof Engine;

describe("engine public interface", () => {
  it("declares a semantic version", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exposes exactly the ten frozen methods", () => {
    expectTypeOf<EngineMethod>().toEqualTypeOf<
      | "capabilities"
      | "dataWindow"
      | "indicators"
      | "priceOperation"
      | "evaluateStrategy"
      | "runBacktest"
      | "markToMarket"
      | "proposeSettlement"
      | "score"
      | "impliedVolatilityIndex"
    >();
  });

  it("keeps capabilities and dataWindow synchronous", () => {
    expectTypeOf<ReturnType<Engine["capabilities"]>>().toEqualTypeOf<Capabilities>();
    expectTypeOf<ReturnType<Engine["dataWindow"]>>().toEqualTypeOf<DataWindow>();
  });

  it("makes every one of the eight computations async and wrapped in a Result", () => {
    expectTypeOf<ReturnType<Engine["indicators"]>>().toEqualTypeOf<
      Promise<Result<IndicatorSeries>>
    >();
    expectTypeOf<ReturnType<Engine["priceOperation"]>>().toEqualTypeOf<
      Promise<Result<OperationPricing>>
    >();
    expectTypeOf<ReturnType<Engine["evaluateStrategy"]>>().toEqualTypeOf<
      Promise<Result<Evaluation>>
    >();
    expectTypeOf<ReturnType<Engine["runBacktest"]>>().toEqualTypeOf<
      Promise<Result<BacktestProgress>>
    >();
    expectTypeOf<ReturnType<Engine["markToMarket"]>>().toEqualTypeOf<
      Promise<Result<PortfolioValuation>>
    >();
    expectTypeOf<ReturnType<Engine["proposeSettlement"]>>().toEqualTypeOf<
      Promise<Result<SettlementProposal>>
    >();
    expectTypeOf<ReturnType<Engine["score"]>>().toEqualTypeOf<Promise<Result<Score>>>();
    expectTypeOf<ReturnType<Engine["impliedVolatilityIndex"]>>().toEqualTypeOf<
      Promise<Result<ImpliedVolatilityIndex>>
    >();
  });

  it("carries asOf on every market view row type", () => {
    expectTypeOf<MarketView["candles"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["corporateActions"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["optionSeries"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["optionPrices"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["quotes"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["macro"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["dividendYields"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["impliedVolatilityIndex"][number]>().toHaveProperty("asOf");
  });

  it("derives leg roles and sides from the contracts leg template", () => {
    expectTypeOf<LegRole>().toEqualTypeOf<LegTemplate["role"]>();
    expectTypeOf<Side>().toEqualTypeOf<LegTemplate["side"]>();
  });
});

describe("branded scalars at the seam", () => {
  it("types positions with a signed quantity and fills with a positive one", () => {
    expectTypeOf<Position["quantity"]>().toEqualTypeOf<SignedQuantity>();
    expectTypeOf<Fill["quantity"]>().toEqualTypeOf<Quantity>();
    expectTypeOf<Position["quantity"]>().not.toEqualTypeOf<Fill["quantity"]>();
  });

  it("refuses plain numbers and strings where a validated scalar is expected", () => {
    expectTypeOf<number>().not.toExtend<Centavos>();
    expectTypeOf<number>().not.toExtend<Quantity>();
    expectTypeOf<string>().not.toExtend<DecimalString>();
    expectTypeOf<string>().not.toExtend<ScoreInput["confidence"]>();
    expectTypeOf<DecimalString>().not.toExtend<ScoreInput["confidence"]>();
    expectTypeOf<ScoreInput["confidence"]>().toExtend<DecimalString>();
  });
});

describe("dependent shapes", () => {
  it("derives the settlement expiry from the operation", () => {
    expectTypeOf<keyof ProposeSettlementInput>().toEqualTypeOf<"view" | "operation">();
    expectTypeOf<Operation["expiry"]>().toEqualTypeOf<SessionDate | null>();
  });

  it("keeps settlement and close reason on distinct simulated operation statuses", () => {
    expectTypeOf<SimulatedOperation>().toHaveProperty("closedAt");
    expectTypeOf<Extract<SimulatedOperation, { status: "closed" }>>().toHaveProperty("closeReason");
    expectTypeOf<Extract<SimulatedOperation, { status: "closed" }>>().not.toHaveProperty(
      "settlement",
    );
    expectTypeOf<Extract<SimulatedOperation, { status: "expired" }>>().toHaveProperty("settlement");
    expectTypeOf<Extract<SimulatedOperation, { status: "expired" }>>().not.toHaveProperty(
      "closeReason",
    );
  });

  it("constrains settlement outcomes by leg role and side", () => {
    expectTypeOf<
      Extract<LegSettlement, { leg: { role: "stock" } }>["outcome"]
    >().toEqualTypeOf<"kept">();
    expectTypeOf<Extract<LegSettlement, { leg: { side: "buy" } }>["outcome"]>().toEqualTypeOf<
      "exercised" | "expired_worthless"
    >();
    expectTypeOf<Extract<LegSettlement, { leg: { side: "sell" } }>["outcome"]>().toEqualTypeOf<
      "assigned" | "expired_worthless"
    >();
    expectTypeOf<LegSettlement["outcome"]>().toEqualTypeOf<SettlementOutcome>();
  });

  it("ties held and brier to the presence of a claim", () => {
    expectTypeOf<Extract<Score["thesis"], { claim: null }>>().not.toHaveProperty("held");
    expectTypeOf<Exclude<Score["thesis"], { claim: null }>>().toHaveProperty("brier");
  });

  it("nulls normalizedPnl whenever pnl or maxLoss cannot support it", () => {
    expectTypeOf<Extract<Score, { pnl: null }>["maxLoss"]>().toEqualTypeOf<null>();
    expectTypeOf<Extract<Score, { pnl: null }>["normalizedPnl"]>().toEqualTypeOf<null>();
    expectTypeOf<Extract<Score, { maxLoss: "unbounded" }>["normalizedPnl"]>().toEqualTypeOf<null>();
  });
});

describe("closed vocabularies", () => {
  it("enumerates engine error codes", () => {
    expectTypeOf<(typeof engineErrorCodes)[number]>().toEqualTypeOf<EngineErrorCode>();
    expect(engineErrorCodes).toEqual([
      "invalid_input",
      "unsupported",
      "missing_instrument",
      "insufficient_data",
      "no_series_matches",
      "degenerate_strikes",
      "unsizeable",
      "checkpoint_mismatch",
    ]);
  });

  it("enumerates unsizeable reasons", () => {
    expectTypeOf<(typeof unsizeableReasons)[number]>().toEqualTypeOf<UnsizeableReason>();
    expect(unsizeableReasons).toEqual(["unbounded_max_loss", "no_declared_capital", "zero_units"]);
  });

  it("enumerates note codes", () => {
    expectTypeOf<(typeof noteCodes)[number]>().toEqualTypeOf<NoteCode>();
    expect(noteCodes).toEqual([
      "european_pricing",
      "dividend_yield_defaulted",
      "no_market_price",
      "iv_from_average_price",
      "iv_not_converged",
      "below_intrinsic",
      "stale_price",
      "no_risk_profile",
      "limit_breach_warned",
      "missed_entry",
      "intraday_option_fill_at_fair_value",
      "short_window_not_annualized",
      "non_positive_equity",
      "no_thesis_claim",
      "no_operation",
      "unbounded_max_loss",
      "zero_max_loss",
      "iv_index_not_bracketed",
      "risk_free_rate_defaulted",
      "negative_cash",
      "settlement_pending",
      "settlement_costs_not_modeled",
    ]);
  });

  it("enumerates market view collections and truncation reasons", () => {
    expectTypeOf<(typeof marketViewCollections)[number]>().toEqualTypeOf<MarketViewCollection>();
    expect(marketViewCollections).toEqual([
      "candles",
      "corporateActions",
      "optionSeries",
      "optionPrices",
      "quotes",
      "macro",
      "dividendYields",
      "impliedVolatilityIndex",
    ]);
    expectTypeOf<(typeof truncationReasons)[number]>().toEqualTypeOf<TruncationReason>();
    expect(truncationReasons).toEqual(["after_at", "unreferenced_instrument"]);
  });

  it("enumerates pricing models, candle forms, option rights and exercise styles", () => {
    expectTypeOf<(typeof pricingModels)[number]>().toEqualTypeOf<PricingModel>();
    expect(pricingModels).toEqual(["bsm_continuous_yield"]);
    expectTypeOf<(typeof candleForms)[number]>().toEqualTypeOf<CandleForm>();
    expect(candleForms).toEqual(["adjusted", "nominal"]);
    expectTypeOf<(typeof optionRights)[number]>().toEqualTypeOf<OptionRight>();
    expect(optionRights).toEqual(["call", "put"]);
    expectTypeOf<(typeof exerciseStyles)[number]>().toEqualTypeOf<ExerciseStyle>();
    expect(exerciseStyles).toEqual(["american", "european"]);
  });

  it("enumerates macro series kinds", () => {
    expectTypeOf<(typeof macroSeriesKinds)[number]>().toEqualTypeOf<MacroSeriesKind>();
    expect(macroSeriesKinds).toEqual(["cdi", "selic", "ipca"]);
  });

  it("enumerates price and volatility sources", () => {
    expectTypeOf<(typeof priceSources)[number]>().toEqualTypeOf<PriceSource>();
    expect(priceSources).toEqual(["given", "mid", "last", "close", "average"]);
    expectTypeOf<(typeof volatilitySources)[number]>().toEqualTypeOf<VolatilitySource>();
    expect(volatilitySources).toEqual([
      "given",
      "own_implied",
      "last_trade_implied",
      "closing_iv_index",
    ]);
  });

  it("enumerates signal kinds and evaluation outcomes", () => {
    expectTypeOf<(typeof signalKinds)[number]>().toEqualTypeOf<SignalKind>();
    expect(signalKinds).toEqual(["entry", "exit", "adjust"]);
    expectTypeOf<(typeof evaluationOutcomes)[number]>().toEqualTypeOf<EvaluationOutcome>();
    expect(evaluationOutcomes).toEqual([
      "signal",
      "conditions_not_met",
      "no_series_match",
      "degenerate_strikes",
      "insufficient_data",
      "unsizeable",
    ]);
  });

  it("enumerates backtest vocabularies", () => {
    expectTypeOf<(typeof limitModes)[number]>().toEqualTypeOf<LimitMode>();
    expect(limitModes).toEqual(["enforce", "warn"]);
    expectTypeOf<(typeof fillSources)[number]>().toEqualTypeOf<FillSource>();
    expect(fillSources).toEqual([
      "next_session_open",
      "next_session_average",
      "next_candle_open",
      "fair_value",
      "settlement",
    ]);
    expectTypeOf<(typeof missedEntryReasons)[number]>().toEqualTypeOf<MissedEntryReason>();
    expect(missedEntryReasons).toEqual([
      "no_trades",
      "limit_breach",
      "no_series_match",
      "degenerate_strikes",
      "unsizeable",
    ]);
    expectTypeOf<(typeof closeReasonKinds)[number]>().toEqualTypeOf<CloseReasonKind>();
    expect(closeReasonKinds).toEqual(["exit_rule", "rolled", "period_end"]);
    expectTypeOf<
      (typeof simulatedOperationStatuses)[number]
    >().toEqualTypeOf<SimulatedOperationStatus>();
    expect(simulatedOperationStatuses).toEqual(["closed", "expired"]);
    expectTypeOf<
      (typeof backtestProgressStatuses)[number]
    >().toEqualTypeOf<BacktestProgressStatus>();
    expect(backtestProgressStatuses).toEqual(["paused", "complete"]);
  });

  it("enumerates settlement outcomes", () => {
    expectTypeOf<(typeof settlementOutcomes)[number]>().toEqualTypeOf<SettlementOutcome>();
    expect(settlementOutcomes).toEqual(["kept", "exercised", "assigned", "expired_worthless"]);
  });

  it("enumerates decision kinds, score subjects and decision origins", () => {
    expectTypeOf<(typeof decisionKinds)[number]>().toEqualTypeOf<DecisionKind>();
    expect(decisionKinds).toEqual(["enter", "do_not_enter", "hold", "adjust", "exit"]);
    expectTypeOf<(typeof scoreSubjects)[number]>().toEqualTypeOf<ScoreSubject>();
    expect(scoreSubjects).toEqual(["enter", "do_not_enter", "hold", "adjust", "exit", "analysis"]);
    expectTypeOf<(typeof decisionOriginKinds)[number]>().toEqualTypeOf<DecisionOriginKind>();
    expect(decisionOriginKinds).toEqual(["signal", "manual"]);
  });

  it("enumerates implied volatility index methods and capability vocabularies", () => {
    expectTypeOf<
      (typeof impliedVolatilityIndexMethods)[number]
    >().toEqualTypeOf<ImpliedVolatilityIndexMethod>();
    expect(impliedVolatilityIndexMethods).toEqual(["atm_30d_variance_interpolated"]);
    expectTypeOf<(typeof capabilityVocabularies)[number]>().toEqualTypeOf<CapabilityVocabulary>();
    expect(capabilityVocabularies).toEqual([
      "timeframes",
      "indicators",
      "strikeSelections",
      "expirySelections",
      "sizingRules",
      "exitRules",
      "adjustmentRules",
      "thesisClaims",
      "pricingModels",
    ]);
  });

  it.each([
    ["engineErrorCodes", engineErrorCodes],
    ["unsizeableReasons", unsizeableReasons],
    ["noteCodes", noteCodes],
    ["marketViewCollections", marketViewCollections],
    ["truncationReasons", truncationReasons],
    ["pricingModels", pricingModels],
    ["candleForms", candleForms],
    ["optionRights", optionRights],
    ["exerciseStyles", exerciseStyles],
    ["macroSeriesKinds", macroSeriesKinds],
    ["priceSources", priceSources],
    ["volatilitySources", volatilitySources],
    ["signalKinds", signalKinds],
    ["evaluationOutcomes", evaluationOutcomes],
    ["limitModes", limitModes],
    ["fillSources", fillSources],
    ["missedEntryReasons", missedEntryReasons],
    ["closeReasonKinds", closeReasonKinds],
    ["simulatedOperationStatuses", simulatedOperationStatuses],
    ["backtestProgressStatuses", backtestProgressStatuses],
    ["settlementOutcomes", settlementOutcomes],
    ["decisionKinds", decisionKinds],
    ["scoreSubjects", scoreSubjects],
    ["decisionOriginKinds", decisionOriginKinds],
    ["impliedVolatilityIndexMethods", impliedVolatilityIndexMethods],
    ["capabilityVocabularies", capabilityVocabularies],
  ] as const)("%s has no duplicate members", (_name, members) => {
    expect(new Set(members).size).toBe(members.length);
  });
});
