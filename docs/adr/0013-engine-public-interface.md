---
status: accepted
date: 2026-09-09
---

# The engine public interface: ten methods over one market view, frozen

## Context

ADR-0006 made `packages/engine` a pure package whose public interface would be designed
deliberately and frozen by a later ADR. Three candidate designs were written in
`docs/design/engine-interface/` (A minimal, B flexible, C common-caller) and compared into a
hybrid on the base of C, chosen by the owner on 2026-09-09. ADR-0006 said "designed twice"; this
ADR revises that to "three candidates compared into a hybrid". This ADR freezes the interface.
Everything outside the package (`apps/web`, the AI layer, tests of other modules) depends on the
types below and nothing else; the implementation behind them is private and arrives in Phase 5
tickets.

## Decision

The engine exposes one `Engine` interface with exactly ten methods, one constant
(`ENGINE_VERSION`), one `as const` array per closed vocabulary it declares (`noteCodes`,
`engineErrorCodes`, `settlementOutcomes`, ...) and the types they use. Every input and every
artifact is plain JSON: decimals travel as `DecimalString`, money as integer `Centavos` (BRL,
ADR-0001), quantities as integer `Quantity` (positive, for legs and fills) or `SignedQuantity`
(non-zero, for net positions), a stated confidence as `Confidence` (a `DecimalString` in
`[0, 1]`), dates as ISO `SessionDate`, times as ISO-8601 UTC `Instant`. The numeric scalars are
branded by their Zod schemas, so a plain `string` or `number` does not type-check where a
validated scalar is expected; dates, instants and tickers are plain strings. No `decimal.js`
instance, class, `Date` or `bigint` crosses the seam. `Instant` is canonical millisecond-precision
UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`, `packages/contracts`' `z.iso.datetime({ precision: 3, offset:
false })`); every comparison and every deduplication key inside the engine that identifies a row
by its instant uses `internal/instant.ts#instantMs` (or `compareInstants`, built on it), not
string equality, so two canonical representations of the same instant are never treated as
distinct rows. Closed vocabularies (`Timeframe`,
`IndicatorSpec`, `StrikeSelection`, `ExpirySelection`, `SizingRule`, `ExitRule`,
`AdjustmentRule`, `CostModel`, `RiskProfile`, `Structure`, `LegTemplate`, `Condition`,
`StrategyDefinition`, `ThesisClaim`) are Zod schemas in `packages/contracts`; the engine imports
their derived types only (`import type`, enforced by lint), so `contracts` owns the vocabulary and
the engine stays pure. The engine declares every other type.

Shape (from C): named async methods returning `Promise<Result<T>>`, one `MarketView` input type for
every computation, the engine sorts and truncates the view itself, per-item failures are `null`
plus `notes` rather than a whole-call error, `Provenance` and `notes` on every artifact.
Visibility (from B): every data row carries `asOf` and the single rule is `row.asOf <= at`;
`capabilities()` reports the implemented `kind`s; the backtest checkpoint is tied to a
`configDigest`; `dataWindow()` tells `market-data` what to load. Composition (from A):
`priceOperation` accepts concrete legs or a selection so "instantiate and price" is one call;
`evaluateStrategy` takes a batch of instruments with optional `since` for catch-up; provenance
carries a truncation report.

### The frozen interface

The following is `packages/engine/src/api.ts` verbatim. Code and this ADR must match; when they
disagree, the code is a bug (or this ADR has been superseded).

```ts
import type {
  AdjustmentRule,
  Centavos,
  Confidence,
  CostModel,
  DecimalString,
  ExitRule,
  ExpirySelection,
  IndicatorSpec,
  Instant,
  LegTemplate,
  Quantity,
  RiskProfile,
  SessionDate,
  SignedQuantity,
  SizingRule,
  StrategyDefinition,
  StrikeSelection,
  Structure,
  ThesisClaim,
  Ticker,
  Timeframe,
} from "@fetha/contracts";

export const ENGINE_VERSION = "0.1.0";

export type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError };

export type UnsizeableReason = "unbounded_max_loss" | "no_declared_capital" | "zero_units";
export const unsizeableReasons = [
  "unbounded_max_loss",
  "no_declared_capital",
  "zero_units",
] as const satisfies readonly UnsizeableReason[];

export type EngineError =
  | { code: "invalid_input"; path: string; message: string }
  | { code: "unsupported"; vocabulary: CapabilityVocabulary; kind: string }
  | { code: "missing_instrument"; ticker: Ticker }
  | { code: "insufficient_data"; needed: DataWindow }
  | {
      code: "no_series_matches";
      underlying: Ticker;
      strikes: StrikeSelection[];
      expiry: ExpirySelection;
    }
  | {
      code: "degenerate_strikes";
      underlying: Ticker;
      strikes: StrikeSelection[];
      resolved: DecimalString[];
    }
  | { code: "unsizeable"; reason: UnsizeableReason }
  | { code: "checkpoint_mismatch"; expectedDigest: string; receivedDigest: string };

export type EngineErrorCode = EngineError["code"];
export const engineErrorCodes = [
  "invalid_input",
  "unsupported",
  "missing_instrument",
  "insufficient_data",
  "no_series_matches",
  "degenerate_strikes",
  "unsizeable",
  "checkpoint_mismatch",
] as const satisfies readonly EngineErrorCode[];

export type NoteCode =
  | "european_pricing"
  | "dividend_yield_defaulted"
  | "no_market_price"
  | "iv_from_average_price"
  | "iv_not_converged"
  | "below_intrinsic"
  | "stale_price"
  | "no_risk_profile"
  | "limit_breach_warned"
  | "missed_entry"
  | "intraday_option_fill_at_fair_value"
  | "short_window_not_annualized"
  | "non_positive_equity"
  | "no_thesis_claim"
  | "no_operation"
  | "unbounded_max_loss"
  | "zero_max_loss"
  | "iv_index_not_bracketed"
  | "risk_free_rate_defaulted"
  | "negative_cash"
  | "settlement_pending"
  | "settlement_costs_not_modeled"
  | "less_than_one_effective_unit";
export const noteCodes = [
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
  "less_than_one_effective_unit",
] as const satisfies readonly NoteCode[];

export type Note = { code: NoteCode; message: string };

export type MarketViewCollection =
  | "candles"
  | "corporateActions"
  | "optionSeries"
  | "optionPrices"
  | "quotes"
  | "macro"
  | "dividendYields"
  | "impliedVolatilityIndex";
export const marketViewCollections = [
  "candles",
  "corporateActions",
  "optionSeries",
  "optionPrices",
  "quotes",
  "macro",
  "dividendYields",
  "impliedVolatilityIndex",
] as const satisfies readonly MarketViewCollection[];

export type TruncationReason = "after_at" | "unreferenced_instrument";
export const truncationReasons = [
  "after_at",
  "unreferenced_instrument",
] as const satisfies readonly TruncationReason[];

export type TruncationReport = {
  collection: MarketViewCollection;
  ticker: Ticker | null;
  dropped: number;
  reason: TruncationReason;
};

export type PricingModel = "bsm_continuous_yield";
export const pricingModels = ["bsm_continuous_yield"] as const satisfies readonly PricingModel[];

export type Provenance = {
  engineVersion: string;
  pricingModel: PricingModel;
  truncated: TruncationReport[];
  dataVersion: string | null;
  datasetNotes: string[];
};

export type TradingSession = { date: SessionDate; open: Instant; close: Instant };

export type CandleForm = "adjusted" | "nominal";
export const candleForms = ["adjusted", "nominal"] as const satisfies readonly CandleForm[];

export type Candle = {
  ticker: Ticker;
  timeframe: Timeframe;
  session: SessionDate;
  asOf: Instant;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  tradedQuantity: number;
};

export type CorporateActionFactor = {
  ticker: Ticker;
  exDate: SessionDate;
  asOf: Instant;
  factor: DecimalString;
};

export type OptionRight = "call" | "put";
export const optionRights = ["call", "put"] as const satisfies readonly OptionRight[];

export type ExerciseStyle = "american" | "european";
export const exerciseStyles = ["american", "european"] as const satisfies readonly ExerciseStyle[];

export type OptionSeries = {
  ticker: Ticker;
  underlying: Ticker;
  right: OptionRight;
  strike: DecimalString;
  expiry: SessionDate;
  style: ExerciseStyle;
  asOf: Instant;
};

export type OptionDayPrice = {
  ticker: Ticker;
  session: SessionDate;
  asOf: Instant;
  average: DecimalString | null;
  close: DecimalString | null;
  trades: number;
  tradedQuantity: number;
};

export type Quote = {
  ticker: Ticker;
  asOf: Instant;
  last: DecimalString | null;
  bid: DecimalString | null;
  ask: DecimalString | null;
};

export type MacroSeriesKind = "cdi" | "selic" | "ipca";
export const macroSeriesKinds = [
  "cdi",
  "selic",
  "ipca",
] as const satisfies readonly MacroSeriesKind[];

export type MacroPoint = {
  series: MacroSeriesKind;
  date: SessionDate;
  asOf: Instant;
  annualRate: DecimalString;
};

export type DividendYieldPoint = { underlying: Ticker; asOf: Instant; annualYield: DecimalString };

export type ImpliedVolatilityIndexPoint = {
  underlying: Ticker;
  session: SessionDate;
  asOf: Instant;
  impliedVolatility: DecimalString;
};

export type MarketView = {
  calendar: TradingSession[];
  candles: Candle[];
  corporateActions: CorporateActionFactor[];
  optionSeries: OptionSeries[];
  optionPrices: OptionDayPrice[];
  quotes: Quote[];
  macro: MacroPoint[];
  dividendYields: DividendYieldPoint[];
  impliedVolatilityIndex: ImpliedVolatilityIndexPoint[];
  dataVersion?: string;
  datasetNotes?: string[];
};

export type DataWindow = {
  from: Instant;
  to: Instant;
  instruments: Ticker[];
  timeframes: Timeframe[];
  collections: MarketViewCollection[];
};

export type StrategyVersion = { id: string; definition: StrategyDefinition; structure: Structure };

export type LegRole = LegTemplate["role"];
export type Side = LegTemplate["side"];

export type Leg = { role: LegRole; side: Side; ticker: Ticker; quantity: Quantity };

export type LegInput = Leg & { price?: DecimalString; volatility?: DecimalString };

export type OperationLeg = Leg & { entryPrice: DecimalString };

export type Operation = {
  id: string;
  underlying: Ticker;
  legs: OperationLeg[];
  expiry: SessionDate | null;
  openedAt: SessionDate;
  strategyVersionId: string | null;
  rolledFrom: string | null;
};

export type Fill = {
  ticker: Ticker;
  side: Side;
  quantity: Quantity;
  price: DecimalString;
  session: SessionDate;
  at: Instant;
  costs: Centavos;
};

export type Position = { ticker: Ticker; quantity: SignedQuantity; averageCost: DecimalString };

export type Greeks = {
  delta: DecimalString;
  gamma: DecimalString;
  theta: DecimalString;
  vega: DecimalString;
  rho: DecimalString;
};

export type RiskLimit = keyof RiskProfile["limits"];

export type LimitBreach = { limit: RiskLimit; value: DecimalString; allowed: DecimalString };

export type PriceSource = "given" | "mid" | "last" | "close" | "average";
export const priceSources = [
  "given",
  "mid",
  "last",
  "close",
  "average",
] as const satisfies readonly PriceSource[];

export type VolatilitySource = "given" | "own_implied" | "last_trade_implied" | "closing_iv_index";
export const volatilitySources = [
  "given",
  "own_implied",
  "last_trade_implied",
  "closing_iv_index",
] as const satisfies readonly VolatilitySource[];

export type LegSelection = {
  structure: Structure;
  underlying: Ticker;
  strikes: StrikeSelection[];
  expiry: ExpirySelection;
  quantity: Quantity | SizingRule;
};

export type LegValuation = {
  leg: Leg;
  price: DecimalString | null;
  priceSource: PriceSource | null;
  stale: { session: SessionDate } | null;
  fairValue: DecimalString | null;
  impliedVolatility: DecimalString | null;
  volatilitySource: VolatilitySource | null;
  greeks: Greeks | null;
  timeToExpiryYears: DecimalString | null;
  notes: Note[];
};

export type PayoffPoint = { underlying: DecimalString; pnl: Centavos };

export type OperationPricing = {
  at: Instant;
  underlying: Ticker;
  spot: DecimalString;
  riskFreeRate: DecimalString;
  dividendYield: DecimalString;
  legs: LegValuation[];
  netPremium: Centavos;
  greeks: Greeks;
  payoff: PayoffPoint[];
  breakEvens: DecimalString[];
  maxLoss: Centavos | "unbounded";
  maxGain: Centavos | "unbounded";
  limitBreaches: LimitBreach[];
  notes: Note[];
  provenance: Provenance;
};

export type IndicatorSeries = {
  ticker: Ticker;
  timeframe: Timeframe;
  form: CandleForm;
  candles: Candle[];
  series: { indicator: IndicatorSpec; values: (DecimalString | null)[] }[];
  notes: Note[];
  provenance: Provenance;
};

export type IndicatorReading = { indicator: IndicatorSpec; value: DecimalString | null };

export type SignalBase = {
  strategyVersionId: string;
  ticker: Ticker;
  timeframe: Timeframe;
  at: Instant;
  session: SessionDate;
  indicators: IndicatorReading[];
};

export type Proposal = { legs: Leg[]; pricing: OperationPricing };

export type Signal = SignalBase &
  (
    | { kind: "entry"; proposal: Proposal }
    | { kind: "exit"; operationId: string; rule: ExitRule }
    | { kind: "adjust"; operationId: string; rule: AdjustmentRule; proposal: Proposal }
  );

export type SignalKind = Signal["kind"];
export const signalKinds = ["entry", "exit", "adjust"] as const satisfies readonly SignalKind[];

export type EvaluationOutcome =
  | "signal"
  | "conditions_not_met"
  | "no_series_match"
  | "degenerate_strikes"
  | "insufficient_data"
  | "unsizeable";
export const evaluationOutcomes = [
  "signal",
  "conditions_not_met",
  "no_series_match",
  "degenerate_strikes",
  "insufficient_data",
  "unsizeable",
] as const satisfies readonly EvaluationOutcome[];

export type EvaluationRecord = {
  ticker: Ticker;
  at: Instant;
  session: SessionDate;
  outcome: EvaluationOutcome;
  detail: string | null;
};

export type Evaluation = {
  signals: Signal[];
  evaluations: EvaluationRecord[];
  notes: Note[];
  provenance: Provenance;
};

export type LimitMode = "enforce" | "warn";
export const limitModes = ["enforce", "warn"] as const satisfies readonly LimitMode[];

export type BacktestConfig = {
  strategy: StrategyVersion;
  universe: Ticker[];
  period: { from: SessionDate; to: SessionDate };
  initialCapital: Centavos;
  costModel: CostModel;
  riskProfile: RiskProfile;
  limits: LimitMode;
  sizing: SizingRule | null;
  walkForward: { windowSessions: number } | null;
  seed: number;
};

export type BacktestCheckpoint = {
  schema: 1;
  engineVersion: string;
  configDigest: string;
  cursor: SessionDate;
  state: unknown;
};

export type FillSource =
  "next_session_open" | "next_session_average" | "next_candle_open" | "fair_value" | "settlement";
export const fillSources = [
  "next_session_open",
  "next_session_average",
  "next_candle_open",
  "fair_value",
  "settlement",
] as const satisfies readonly FillSource[];

export type SimulatedFill = Fill & { operationId: string; source: FillSource };

export type MissedEntryReason =
  "no_trades" | "limit_breach" | "no_series_match" | "degenerate_strikes" | "unsizeable";
export const missedEntryReasons = [
  "no_trades",
  "limit_breach",
  "no_series_match",
  "degenerate_strikes",
  "unsizeable",
] as const satisfies readonly MissedEntryReason[];

export type MissedEntry = {
  ticker: Ticker;
  signalAt: Instant;
  sessionsTried: number;
  reason: MissedEntryReason;
};

export type CloseReason =
  | { kind: "exit_rule"; rule: ExitRule }
  | { kind: "rolled"; toOperationId: string }
  | { kind: "period_end" };

export type CloseReasonKind = CloseReason["kind"];
export const closeReasonKinds = [
  "exit_rule",
  "rolled",
  "period_end",
] as const satisfies readonly CloseReasonKind[];

export type SettlementOutcome = "kept" | "exercised" | "assigned" | "expired_worthless";
export const settlementOutcomes = [
  "kept",
  "exercised",
  "assigned",
  "expired_worthless",
] as const satisfies readonly SettlementOutcome[];

export type LegSettlement =
  | { leg: OperationLeg & { role: "stock" }; outcome: "kept"; intrinsicValue: null; fills: Fill[] }
  | {
      leg: OperationLeg & { role: Exclude<LegRole, "stock">; side: "buy" };
      outcome: "exercised" | "expired_worthless";
      intrinsicValue: DecimalString;
      fills: Fill[];
    }
  | {
      leg: OperationLeg & { role: Exclude<LegRole, "stock">; side: "sell" };
      outcome: "assigned" | "expired_worthless";
      intrinsicValue: DecimalString;
      fills: Fill[];
    };

export type SimulatedOperation = Operation & {
  pnl: Centavos;
  maxLoss: Centavos | "unbounded";
} & (
    | { status: "closed"; closedAt: SessionDate; closeReason: CloseReason }
    | { status: "expired"; closedAt: SessionDate; settlement: LegSettlement[] }
  );

export type SimulatedOperationStatus = SimulatedOperation["status"];
export const simulatedOperationStatuses = [
  "closed",
  "expired",
] as const satisfies readonly SimulatedOperationStatus[];

export type EquityPoint = {
  session: SessionDate;
  equity: Centavos;
  cash: Centavos;
  drawdown: DecimalString;
};

export type BacktestMetrics = {
  sessions: number;
  operations: number;
  totalReturn: DecimalString;
  cagr: DecimalString | null;
  maxDrawdown: DecimalString;
  sharpe: DecimalString | null;
  winRate: DecimalString | null;
  profitFactor: DecimalString | null;
  exposure: DecimalString;
  fees: Centavos;
  taxes: Centavos;
  slippage: Centavos;
};

export type WalkForwardWindow = { from: SessionDate; to: SessionDate; metrics: BacktestMetrics };

export type MonthlyTax = {
  month: string;
  stockSales: Centavos;
  stockGain: Centavos;
  optionGain: Centavos;
  exemptGain: Centavos;
  netGain: Centavos;
  tax: Centavos;
};

export type SessionLimitBreach = LimitBreach & { session: SessionDate; ticker: Ticker };

export type BacktestRun = {
  config: BacktestConfig;
  configDigest: string;
  operations: SimulatedOperation[];
  fills: SimulatedFill[];
  missedEntries: MissedEntry[];
  limitBreaches: SessionLimitBreach[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  walkForward: WalkForwardWindow[] | null;
  taxes: MonthlyTax[];
  notes: Note[];
  provenance: Provenance;
};

export type BacktestProgress =
  | {
      status: "paused";
      checkpoint: BacktestCheckpoint;
      sessionsDone: number;
      sessionsTotal: number;
      next: DataWindow;
    }
  | { status: "complete"; run: BacktestRun };

export type BacktestProgressStatus = BacktestProgress["status"];
export const backtestProgressStatuses = [
  "paused",
  "complete",
] as const satisfies readonly BacktestProgressStatus[];

export type PositionValuation = {
  position: Position;
  price: DecimalString | null;
  priceSource: PriceSource | null;
  stale: { session: SessionDate } | null;
  value: Centavos | null;
  unrealizedPnl: Centavos | null;
  notes: Note[];
};

export type OperationValuation = {
  operation: Operation;
  pricing: OperationPricing;
  unrealizedPnl: Centavos;
};

export type PortfolioValuation = {
  at: Instant;
  positions: PositionValuation[];
  operations: OperationValuation[];
  totals: { equity: Centavos; cash: Centavos; unrealizedPnl: Centavos; greeks: Greeks };
  limitBreaches: LimitBreach[];
  notes: Note[];
  provenance: Provenance;
};

export type SettlementProposal = {
  operationId: string;
  expiry: SessionDate;
  underlyingClose: DecimalString;
  legs: LegSettlement[];
  notes: Note[];
  provenance: Provenance;
};

export type DecisionKind = "enter" | "do_not_enter" | "hold" | "adjust" | "exit";
export const decisionKinds = [
  "enter",
  "do_not_enter",
  "hold",
  "adjust",
  "exit",
] as const satisfies readonly DecisionKind[];

export type ScoreSubject = DecisionKind | "analysis";
export const scoreSubjects = [
  ...decisionKinds,
  "analysis",
] as const satisfies readonly ScoreSubject[];

export type DecisionOrigin = { kind: "signal"; strategy: StrategyVersion } | { kind: "manual" };

export type DecisionOriginKind = DecisionOrigin["kind"];
export const decisionOriginKinds = [
  "signal",
  "manual",
] as const satisfies readonly DecisionOriginKind[];

export type PnlScore =
  | { pnl: null; maxLoss: null; normalizedPnl: null }
  | { pnl: Centavos; maxLoss: "unbounded"; normalizedPnl: null }
  | { pnl: Centavos; maxLoss: Centavos; normalizedPnl: DecimalString | null };

export type ThesisScore =
  { claim: null } | { claim: ThesisClaim; held: boolean; brier: DecimalString };

export type Score = PnlScore & {
  thesis: ThesisScore;
  counterfactualPnl: Centavos | null;
  notes: Note[];
  provenance: Provenance;
};

export type ImpliedVolatilityIndexMethod = "atm_30d_variance_interpolated";
export const impliedVolatilityIndexMethods = [
  "atm_30d_variance_interpolated",
] as const satisfies readonly ImpliedVolatilityIndexMethod[];

export type ImpliedVolatilityIndex = {
  underlying: Ticker;
  session: SessionDate;
  impliedVolatility: DecimalString | null;
  method: ImpliedVolatilityIndexMethod;
  seriesUsed: Ticker[];
  notes: Note[];
  provenance: Provenance;
};

export type Capabilities = {
  engineVersion: string;
  timeframes: Timeframe[];
  indicators: IndicatorSpec["kind"][];
  strikeSelections: StrikeSelection["kind"][];
  expirySelections: ExpirySelection["kind"][];
  sizingRules: SizingRule["kind"][];
  exitRules: ExitRule["kind"][];
  adjustmentRules: AdjustmentRule["kind"][];
  thesisClaims: ThesisClaim["kind"][];
  pricingModels: PricingModel[];
};

export type CapabilityVocabulary = keyof Omit<Capabilities, "engineVersion">;
export const capabilityVocabularies = [
  "timeframes",
  "indicators",
  "strikeSelections",
  "expirySelections",
  "sizingRules",
  "exitRules",
  "adjustmentRules",
  "thesisClaims",
  "pricingModels",
] as const satisfies readonly CapabilityVocabulary[];

export type DataWindowInput = {
  strategy: StrategyVersion;
  instruments: Ticker[];
  calendar: TradingSession[];
  at: Instant;
  since?: Instant;
};

export type IndicatorsInput = {
  view: MarketView;
  ticker: Ticker;
  timeframe: Timeframe;
  indicators: IndicatorSpec[];
  at: Instant;
  form?: CandleForm;
};

export type PriceOperationInput = {
  view: MarketView;
  at: Instant;
  legs: LegInput[] | LegSelection;
  riskProfile?: RiskProfile;
  openOperationCount?: number;
};

export type EvaluateStrategyInput = {
  view: MarketView;
  strategy: StrategyVersion;
  instruments: Ticker[];
  at: Instant;
  since?: Instant;
  openOperations?: Operation[];
  riskProfile?: RiskProfile;
};

export type RunBacktestInput = {
  view: MarketView;
  config: BacktestConfig;
  resume?: BacktestCheckpoint;
  maxSessions?: number;
};

export type MarkToMarketInput = {
  view: MarketView;
  at: Instant;
  positions: Position[];
  operations: Operation[];
  cash: Centavos;
  riskProfile?: RiskProfile;
};

export type ProposeSettlementInput = { view: MarketView; operation: Operation };

export type ScoreInput = {
  view: MarketView;
  subject: ScoreSubject;
  decidedAt: Instant;
  horizon: SessionDate;
  confidence: Confidence;
  claim: ThesisClaim | null;
  operation?: Operation;
  realizedFills: Fill[];
  origin: DecisionOrigin;
  costModel: CostModel;
};

export type ImpliedVolatilityIndexInput = { view: MarketView; underlying: Ticker; at: Instant };

export interface Engine {
  capabilities(): Capabilities;
  dataWindow(input: DataWindowInput): DataWindow;
  indicators(input: IndicatorsInput): Promise<Result<IndicatorSeries>>;
  priceOperation(input: PriceOperationInput): Promise<Result<OperationPricing>>;
  evaluateStrategy(input: EvaluateStrategyInput): Promise<Result<Evaluation>>;
  runBacktest(input: RunBacktestInput): Promise<Result<BacktestProgress>>;
  markToMarket(input: MarkToMarketInput): Promise<Result<PortfolioValuation>>;
  proposeSettlement(input: ProposeSettlementInput): Promise<Result<SettlementProposal>>;
  score(input: ScoreInput): Promise<Result<Score>>;
  impliedVolatilityIndex(
    input: ImpliedVolatilityIndexInput,
  ): Promise<Result<ImpliedVolatilityIndex>>;
}
```

### Semantics

#### Visibility

- A row is visible to a computation at instant `t` iff `row.asOf <= t`. `asOf` is the candle
  close for candles, the ex-date session open for corporate-action factors, the session close
  for daily option prices, the publication time for macro points, the quote timestamp for quotes,
  the listing time for option series, the publication time for dividend yields and
  implied-volatility index points. The calendar is the only collection exempt (a published
  schedule).
- Every method has one **truncation instant** for the whole call: `at` when the input carries
  one; the horizon session close for `score`; the operation's `expiry` session close for
  `proposeSettlement`; the `period.to` session close for `runBacktest`. Rows later than it are dropped before any
  computation and counted in `provenance.truncated` with reason `after_at`; rows for instruments
  the call does not reference are counted with reason `unreferenced_instrument`.
- The rule also quantifies over every **evaluation instant** inside a call. `evaluateStrategy`
  with `since` evaluates at each candle close `c` in `(since, at]` on the view truncated at `c`,
  and the proposal it prices has `pricing.at = c`. `runBacktest` evaluates each session on the
  view truncated at that session's close and fills a signal from session D with session D+1 data
  only (ADR-0004); an intraday run evaluates at each candle close of the strategy's timeframe and
  fills at the next candle of that timeframe (ADR-0011, sharpened under "Fills" below). `score`
  never reads a row later than the horizon close, `proposeSettlement` never reads one later than
  the expiry close, whatever the view contains. Rows dropped by an inner instant are simply
  invisible to that evaluation; they are not reported.

#### Candles and corporate actions

- The view carries **nominal candles only**, plus `corporateActions`: one factor per instrument
  and ex-date, `asOf` = the ex-date session open, `factor` = the multiplier that makes prices
  before the ex-date comparable with prices after it. The factor becomes visible at the open, not
  the close, so every evaluation inside the ex-date session (intraday candles included) reads the
  same adjusted series as the session close does; the ex-date candle itself is never adjusted
  (`exDate > s` fails for it). The engine derives the **adjusted series
  at each evaluation instant `c`**: a nominal candle of session `s` has `open`, `high`, `low`
  and `close` multiplied by the product of that ticker's factors with `exDate > s` and
  `asOf <= c`; `tradedQuantity` is not adjusted. A factor ingested later therefore never rewrites
  an artifact computed at an earlier instant (I1). This amends ADR-0004 on one point: the
  ingestion layer records and versions factors (`dataVersion`), the engine applies them.
- Indicators, conditions and `iv_rank` read the adjusted series; strikes, option prices, fills,
  settlement and thesis claims read nominal. `IndicatorsInput.form` defaults to `adjusted`;
  `IndicatorSeries.candles` are the candles in the requested form.
- `tradedQuantity` is the integer count of shares or contracts traded in the candle or session;
  the DSL price field of the same name reads it.

#### Rates, time and greeks (ADR-0002 conventions)

- **Risk-free rate**: the latest visible `cdi` macro point. Its `annualRate` is the CDI annual
  rate compounded over 252 business days, so the model's continuous rate is
  `r = ln(1 + cdi)` and the per-session simple rate used by metrics is
  `(1 + cdi)^(1/252) - 1`. `OperationPricing.riskFreeRate` reports `r`.
- **Dividend yield**: the latest visible `annualYield` for the underlying, an annual simple
  yield, converted to the model's continuous yield `q = ln(1 + annualYield)`; zero with note
  `dividend_yield_defaulted` when none is visible. `OperationPricing.dividendYield` reports `q`.
- **Time to expiry** in years is `(n + (1 - f)) / 252`, where `n` is the number of sessions
  strictly after the session containing `at` up to and including the expiry session and `f` is
  the fraction of that session elapsed at `at` (`(at - open) / (close - open)` clamped to
  `[0, 1]`). At a session close `f = 1`, so a daily evaluation uses `n / 252`; at the expiry
  session close it is zero.
- **Greeks** per leg: `delta` per 1.00 of underlying, `gamma` per 1.00 of underlying squared,
  `theta` per session (annual theta / 252, negative when the leg loses value with time; the
  same 252-session clock as time to expiry, so theta times sessions elapsed is the model's decay
  over that span; a per-calendar-day figure on screen is a UI conversion, never an engine output
  and never used in attribution),
  `vega` per 1 volatility point (0.01), `rho` per 1.00 of rate. Aggregate greeks (operation and
  portfolio) are signed sums, `sum(sign * quantity * greek)` with `sign = +1` for `buy` and `-1`
  for `sell`; a stock leg contributes `delta = sign * quantity` and zero elsewhere.
- **Volatility source** behind every `fairValue`, reported in `LegValuation.volatilitySource`:
  `given` when the caller supplied `LegInput.volatility` (what-if pricing; `impliedVolatility` is
  still solved from the market price when there is one); `own_implied` when the leg has a market
  price at `at` and the volatility is solved from it; `last_trade_implied` when the leg is
  `stale` and the volatility solved from its last trade is repriced at `at` (ADR-0014 Q42);
  `closing_iv_index` for `fair_value` fills in intraday backtests (ADR-0011 as amended by
  ADR-0014), read as the latest implied-volatility index point visible at the fill instant,
  which is the previous session's close for an intraday fill. `null` when there is no `fairValue`.

#### Operations, positions and strategy versions

- **`Operation.expiry`** is the one expiry every option leg of the operation shares (ADR-0014
  Q43), `null` exactly when the operation has no option legs. The engine checks it wherever an
  `Operation` comes in (`evaluateStrategy`, `markToMarket`, `proposeSettlement`, `score`): an
  option leg whose series in the view expires on another session, an option leg on an operation
  with `expiry: null`, or a stock-only operation with an expiry is `invalid_input` with the leg's
  path.
- **`Position.quantity`** is a `SignedQuantity`: positive for a net long, negative for a net short
  (a written option or a short stock position). `averageCost` is the average price of the fills
  that opened the net position, unsigned. A position valuation multiplies price by the signed
  quantity, so a short position has a negative `value` and gains when the price falls. A closed
  position is not a position: the caller omits it, and zero is unrepresentable in the type.
- **`StrategyVersion` coherence.** The definition and the structure must describe the same thing:
  `definition.structureId !== structure.id` is `invalid_input` (path `definition.structureId`).
  When the structure has no option legs, a definition with `strikes`, an `expiry`, a
  `days_before_expiry` exit or a `roll` adjustment is `invalid_input`; when it has option legs, a
  definition without `expiry` is `invalid_input` and `strikes.length` must equal the number of
  distinct strike ranks. The schema cannot see the structure, so these checks live here and only
  here.

#### `priceOperation`

- With `LegInput[]`, each leg is priced as given. With a `LegSelection`, `strikes[i]` resolves
  strike rank `i + 1` of the structure's option legs; `strikes.length` must equal the number of
  distinct ranks, else `invalid_input`. `delta.target` is an absolute delta in `(0, 1)`
  (schema) matched to the listed strike whose `|delta|` at `at` is nearest; `moneyness.percent`
  is relative to spot, positive above and negative below (`spot * (1 + percent)`, then the
  nearest listed strike); `nearest.price` picks the listed strike nearest to the price. Resolved
  strikes must be strictly ascending in rank order, and legs that share a rank share a strike
  (a straddle). When two distinct ranks resolve to the same strike the selection is degenerate:
  `degenerate_strikes` with the resolved strikes. No listed series for a rank is
  `no_series_matches`.
- Expiry: the `business_days` window `[min, max]` counts sessions strictly after the session of
  `at`; the earliest listed expiry inside the window is chosen; `min >= 1` (schema) so a
  same-session expiry is never selected. `expiry` is required whenever the strategy selects
  strikes (schema); the engine additionally rejects a structure with option legs and no expiry
  as `invalid_input` (see "Operations, positions and strategy versions").
- Quantity: a `Quantity` is structure units, each leg's quantity is `ratio * units`; a
  `SizingRule` needs `riskProfile.declaredCapital`, else `unsizeable` (`no_declared_capital`);
  `fixed_risk` with an unbounded max loss is `unsizeable` (`unbounded_max_loss`). Without a
  `riskProfile` pricing proceeds with note `no_risk_profile` and empty `limitBreaches` (ADR-0014
  Q44); `openOperationCount` feeds the `maxOpenOperations` limit.
- Prices: `priceSource` is `given`, else `mid` when bid and ask are visible, else `last`, else
  `close`, else `average` (note `iv_from_average_price`). A leg with no visible price is `null`
  with note `no_market_price` and is priced at fair value only when a volatility source exists.

#### Indicators

Reference formulas, on the adjusted close unless stated:

- `sma`: arithmetic mean of the last `length` closes.
- `ema`: `k = 2 / (length + 1)`, seeded with the SMA of the first `length` candles.
- `rsi` per Wilder: the first average gain and loss are simple means over `length` changes, then
  Wilder smoothing `avg = (prev * (length - 1) + current) / length`;
  `RSI = 100 - 100 / (1 + avgGain / avgLoss)`, 100 when `avgLoss = 0` and `avgGain > 0`, `null`
  when both averages are zero (a flat window has no momentum to rank).
- `atr`: Wilder-smoothed true range, `TR = max(high - low, |high - prevClose|, |low - prevClose|)`,
  the first ATR being the simple mean of the first `length` true ranges.
- `iv_rank`: a 0-100 percentile rank of the underlying's implied-volatility index,
  `100 * below / (lookbackSessions - 1)`, where `below` counts the points strictly below the
  current one in the window of the `lookbackSessions` most recent visible index points (current
  included). ADR-0008's `iv_rank > 50` reads on this scale.

Every indicator is `null` until it has enough candles or points. `iv_rank` on an intraday
timeframe aligns each candle to the latest implied-volatility index point with
`point.asOf <= candle.asOf`, never a point published at that same session's close but after the
candle formed; the alignment compares instants (`internal/align-by-instant.ts`), never session
dates, so a same-session closing point cannot leak into an earlier intraday reading.

`dataWindow` requests a warm-up of `3 * length` candles for the recursive indicators (`ema`,
`rsi`, `atr`), instead of the mathematical minimum (`length` for `ema`, `length + 1` for `rsi`
and `atr`), so a live evaluation and a backtest seeded from the same `from` reconcile: the
mathematical minimum seeds correctly but a live evaluation replaying only that many candles has
not converged to the same recursive average a backtest computes from a longer history, and the
gap compounds through Wilder smoothing. `sma` and `iv_rank` need no such warm-up: `sma` has no
memory across windows and `iv_rank`'s lookback is already a session count, not a candle count.

#### `evaluateStrategy`

Evaluates at every candle close of the strategy's timeframe in `(since, at]`, or once at the
latest close `<= at` when `since` is omitted. Every evaluation produces an `EvaluationRecord`;
only `entry`, `exit` and `adjust` outcomes also produce a `Signal`. `no_series_match`,
`degenerate_strikes`, `insufficient_data` and `unsizeable` are records, never signals (ADR-0014
Q45), with the failed selection or rule in `detail`. The engine does not mark late signals: it
has no clock; the caller compares `signal.at` with its own time (ADR-0010).

**Stock-only scope (#15).** Option structures, strike/expiry selection and option pricing are
#23; until then `evaluateStrategy` implements the structures whose legs are all `stock` and
refuses everything else with `unsupported`, vocabulary `strikeSelections`, the caller's own first
strike-selection `kind` (coherence already guarantees `strikes` is non-empty whenever the
structure has option legs, so this is never a lookup on an empty array). Decisions taken to make
that subset concrete:

- **Condition truncation per evaluation instant.** Each evaluation instant `c` gets its own
  adjusted candle series and indicator readings, computed exactly as `indicators()` would at
  `at = c` (candle close, corporate-action adjustment, indicator warm-up, all included): nothing
  is cached or extrapolated across evaluation instants. This is the direct, unoptimized reading
  of "each evaluation sees the view truncated at its own close" and is what makes I1 hold at every
  inner instant for free, including a corporate-action factor whose `asOf` falls inside a later
  instant's window but not an earlier one's. `provenance.truncated`, by contrast, is computed once
  for the whole call at `at` (rows for instruments outside `instruments`, or with `asOf` after
  `at`); per-instant truncation is not reported, matching "rows dropped by an inner instant are
  simply invisible to that evaluation; they are not reported."
- **Missing instrument.** A `StrategyVersion` has no instrument of its own; the only way one can
  be "referenced but absent" is through `openOperations`. An operation whose `underlying` is not
  among `instruments` is `invalid_input` (path `openOperations[i].underlying`): the batch is what
  the engine computes candles and indicators for, so an operation outside it has nothing to
  evaluate against. An operation with a non-stock leg, or a stock-only operation carrying an
  `expiry`, is `invalid_input` for the same reason coherence rejects them on the definition side
  (paths `openOperations[i].legs` and `openOperations[i].expiry`); a stock leg whose own `ticker`
  differs from its operation's `underlying` is `invalid_input` the same way (path
  `openOperations[i].legs[j].ticker`). An instrument in `instruments` with no candle for the
  strategy's timeframe is not silently skipped: it gets exactly one `insufficient_data`
  `EvaluationRecord` at `at`, so the caller can tell "nothing to evaluate" from "the batch
  produced nothing." The same holds when the instrument has candles but none falls in
  `(since, at]`: that also gets one `insufficient_data` record at `at`, distinct in `detail` from
  the no-candles-at-all case. Every such record's `session` is resolved from `view.calendar` (the
  last session whose `open <= at`, the rule `dataWindow` already uses), not by slicing `at`'s own
  date; the fallback — slicing `at`'s own ISO date, a UTC slice rather than a B3-calendar one —
  triggers whenever the calendar does not cover `at`, whether because `view.calendar` is empty or
  because every session it does carry opens after `at`, not only when the view carries no calendar
  row at all.
- **Batch validation.** Duplicate tickers in `instruments`, duplicate `id`s in `openOperations`,
  and duplicate `(series, asOf)` rows in `macro` or `(underlying, asOf)` rows in `dividendYields`
  are `invalid_input`, checked once for the whole call — including when `instruments` is empty,
  so an inconsistent view is never silently accepted just because nothing was asked of it. The
  same pass rejects a non-positive candle price anywhere in `view.candles` and a non-positive
  corporate-action factor anywhere in `view.corporateActions` (true index in the path in both
  cases, including rows for tickers outside `instruments` — `buildCandleSeries` also checks both,
  but only over the per-ticker slice it is called with, so this batch-wide pass is what gives a
  correct index and unreferenced-ticker coverage) and a macro `annualRate` or dividend
  `annualYield` of `-1` or below, which would make `ln(1 + rate)` undefined downstream.
- **Entry gating.** At evaluation instant `c`, an open operation for the instrument participates
  only when `op.openedAt <= nominalCandle.session`; before that session the instrument is treated
  as having no open operation and entry gating applies normally (ADR-0014 Q47 states the
  no-pyramiding rule this gating implements). `Operation` carries no `closedAt`, so an operation
  closed inside `(since, at]` is never represented in `openOperations`: catch-up re-evaluates
  entry for every instant from the close onward as if the instrument were flat again, which is
  correct only when the caller pre-filters `openOperations` by `strategyVersionId` (an operation
  the caller closed under a different version, or intends to keep open regardless of what this
  version's entry condition says, must not be passed in). When an active operation exists, only
  that instrument's exit rules are evaluated and entry is skipped entirely for that instant. The
  `openOperationCount` a proposal's `maxOpenOperations` limit check is priced against is the same
  `op.openedAt <= nominalCandle.session` count, taken over the whole batch's `openOperations`
  (every instrument, not just the one being priced): an operation the batch will open later never
  counts toward an earlier instant's limit.
- **Sizing and risk for a stock leg.** A `SizingRule`'s "unit" is one structure unit (`ratio *
units` per leg, as in `priceOperation`); `fixed_fractional` budgets `fraction *
declaredCapital` and divides by the notional cost of one unit; `fixed_risk` budgets the same
  fraction against the unit's max loss, which is bounded (the entry price) for a `buy` leg and
  unbounded for a `sell` leg, so `fixed_risk` on a structure with any short stock leg is
  unsizeable. Fewer than one unit is unsizeable (`EvaluationOutcome`, not `EngineError`; the
  `detail` string is freeform since `EvaluationRecord` carries no structured reason).
- **Pricing a stock-only proposal.** `priceOperation` itself stays `unsupported` (#23 covers
  strike/expiry selection and option pricing uniformly); a stock leg needs none of that, so
  `evaluateStrategy` prices its own proposals directly. `spot` and each leg's `price` are the
  nominal close (a real, tradable price; adjusted prices are a synthetic construct for indicator
  continuity only). Each leg's `greeks` are its per-unit sensitivity (`delta: "1.000000"`,
  everything else zero, per the "a stock leg contributes `delta = sign * quantity`" rule); the
  aggregate `greeks.delta` is `sum(sign * quantity)`. `maxLoss`/`maxGain` are positive magnitudes
  (so `normalizedPnl = pnl / maxLoss` keeps realized-loss sign correct elsewhere in the engine):
  a net-long combination has `maxGain: "unbounded"` and a bounded `maxLoss` at the payoff's value
  as the underlying goes to zero; a net-short combination is the mirror; a delta-neutral pair
  (`netSlope = 0`) is bounded both ways at that same zero-price payoff. `breakEvens` is exact
  (`[entryPrice]`) for a single leg and left empty for multi-leg stock structures, a v1
  simplification noted here rather than solved generically. `payoff` is three points
  (`spot * 0.8, 1, 1.2`), a minimal table; a fuller grid is deferred with the rest of payoff
  computation to its own ticket. Limit checks against `riskProfile` always run in warn mode
  (ADR-0014 Q49: `evaluateStrategy` has no `limits: LimitMode` the way `BacktestConfig` does);
  a breach is noted (`limit_breach_warned`) and the proposal still built, per ADR-0014 Q39's warn
  semantics, plus `maxPremiumBought` checked against the proposal's net premium when the structure
  is net debit. The nested `OperationPricing.provenance.truncated` on a proposal is always `[]`:
  truncation is reported once at the evaluation's own `provenance.truncated`, not per proposal.
- **Exit rule evaluation.** `profit_target` and `stop_loss` are evaluated numerically against the
  operation's own legs and the current nominal close (never `unknown`, since prices are always
  present once a candle exists); `condition` reuses the same three-valued (`true`/`false`/
  `unknown`) tree evaluator as entry. Rules are tried in the order ADR-0014 Q48 fixes; further
  rules are not evaluated once one signals. Each numeric rule is checked against a base computed
  once per operation from its entry legs via `priceStockLegs` (ADR-0014 Q50): `profit_target`
  against `|netPremium|`, `stop_loss` against `maxLoss` when finite else `|netPremium|`; a zero
  base means the rule can never fire, and the evaluation record's `detail` says so. Before that
  comparison, the nominal close — not the entry price — is rebased onto the entry price's own
  scale, dividing by the product of the ticker's visible corporate-action factors with `exDate` in
  `(op.openedAt, nominalCandle.session]` (the same factors, and the same convention,
  `buildCandleSeries` uses to adjust a candle series, but applied in the opposite direction here).
  Per-leg pnl is `side × quantity × (close / f − entryPrice)` in centavos, with `side = +1` for a `buy` leg and `−1` for a `sell` leg: `quantity` and `entryPrice` are
  true money on the scale the operation was opened at and are never touched, so a position opened
  before a split is compared to the post-split close on the same scale instead of firing a stop or
  target on the split alone, and the money is right, not just the sign — scaling `entryPrice` by
  `f` instead (the earlier, incorrect approach) leaves the pnl off by a factor of `1/f`.
  `days_before_expiry` cannot appear on a stock-only definition
  (coherence rejects it), so the evaluator's exhaustive `switch` throws if it somehow does — a
  bug, not a runtime outcome. `EvaluationRecord.outcome` for an instant with an open operation is
  `signal` if any exit fired, `insufficient_data` if none fired but some `condition` rule was
  `unknown`, else `conditions_not_met`.
- **Capabilities.** Both `SizingRule` kinds (`fixed_fractional`, `fixed_risk`) are implemented in
  full; of the `ExitRule` kinds, `profit_target`, `stop_loss` and `condition` are implemented and
  `days_before_expiry` stays unsupported (it is meaningless without an expiry, which a stock-only
  structure's coherence check forbids). No `AdjustmentRule` kind is implemented: the only one,
  `roll`, needs option legs the same way.

#### `runBacktest`

- Advances from `resume.cursor` (or `period.from`) while data, `maxSessions` and the period
  allow, then returns `paused` with a checkpoint and `next`, the `DataWindow` the next call needs
  (`from` = the close of the first session the strategy's lookback reaches back to from the
  cursor, `to` = the `period.to` session close), or `complete`. The checkpoint `state` depends
  only on rows with `asOf <=` the cursor session's close; that is the truncation instant of the
  paused run (I7). A resumed call's `view.calendar` must be the same calendar the run started
  with (`market-data` builds it once from the shared reference data and hands it to every chunk);
  a resumed view missing a candle an open position's mark needs is `insufficient_data`, naming
  the underlying and session, not a thrown exception, and `resume.schema` must equal the
  checkpoint schema the engine currently produces, alongside `configDigest` and `engineVersion`,
  else `checkpoint_mismatch`.
- Sizing fractions and risk-profile limits apply to the run's current equity;
  `riskProfile.declaredCapital` is ignored inside a run. `config.sizing` overrides the strategy's
  sizing rule when present. Missed entries, warn mode and fill-time failures follow ADR-0014.
- **Fills.** In a daily run a signal evaluated at session D's close fills with session D+1
  data: stocks at the next session's open (`next_session_open`), options at the next session's
  average traded price (`next_session_average`). In an intraday run a signal at candle `k` of the
  strategy's timeframe fills at candle `k + 1` of that timeframe: stock at that candle's open
  (`next_candle_open`); options at model fair value on that candle's open spot with the latest
  implied-volatility index point visible at that instant (`fair_value`; ADR-0011 as amended by
  ADR-0014), plus slippage. `Fill.price` includes slippage: the option reference price times
  `(1 + optionSlippageRate)` for a buy and `(1 - optionSlippageRate)` for a sell, at scale 2.
  `Fill.costs` = B3 fee (`b3FeeRate` on the gross traded value) plus brokerage. A single
  `b3FeeRate` over every fill is the accepted v1 simplification of B3's per-instrument fee
  table.
- **Simulated operations.** A `SimulatedOperation` is `closed` (by an exit rule, by a roll into
  `toOperationId`, or by `period_end`) or `expired` (reached its `expiry`, with the per-leg
  `settlement`). The status is a discriminated union so an expired operation carries no
  `CloseReason` and a closed one no `settlement`; expiry is therefore a status, not a close
  reason. There is no `open` status: a complete run holds nothing. An operation still held at the
  `period.to` session close is closed there with `closeReason: { kind: "period_end" }` at the
  mark of that close (a stale mark per ADR-0014 Q42 when a series did not trade), with no
  slippage and no costs, since it is a valuation and not a trade; no fill is recorded and it is
  not a taxable event. Such an operation counts in `metrics.operations` but is excluded from
  `winRate` and `profitFactor`. A rolled operation is `closed` with reason `rolled` and
  the new operation records `rolledFrom`; there is no `adjusted` status in a run (the lifecycle
  status of a real operation belongs to `portfolio`, not to this seam). A missed entry is not an
  operation: nothing was filled, so it has no id, legs, entry prices or P&L, and it is recorded in
  `missedEntries` (ADR-0014 Q38), never in `operations`.
- **Settlement in a run.** At an operation's `expiry` the engine applies the settlement rule of
  `proposeSettlement` (ADR-0014 Q41) without asking: in-the-money legs are exercised or assigned
  at the strike, out-of-the-money legs expire worthless, stock legs are kept. The stock fills this
  produces carry `source: "settlement"`, price = strike, no slippage, and `costs` as any stock
  fill; they are listed in `run.fills` and, per leg, in `settlement[i].fills` (the same fills; an
  attribution view, never counted twice). Stock those fills create nets out inside the operation
  when the structure closes on itself (a vertical with both legs in the money, an assigned
  covered call against its stock leg). Residual stock that does not net out (a lone long call
  exercised leaves long stock, a lone long put exercised leaves short stock, a lone short put
  assigned leaves long stock, a lone short call assigned leaves short stock) is closed at the
  next session's open with `source: "next_session_open"`, attributed to the operation (its
  `operationId`, listed in `run.fills`, not in `settlement[i].fills`), and the operation's `pnl`
  is realized only then; `closedAt` stays the expiry session, since the status describes what
  ended the operation. A `kept` stock leg is closed the same way, so an `expired` operation is
  always fully realized. When the expiry session is `period.to` there is no next session and
  the residual is marked at that close under the `period_end` rule above, with the same
  exclusions from `winRate` and `profitFactor`.
- **Operation P&L** (`SimulatedOperation.pnl`) is realized: fills net of costs, slippage already
  inside the prices, before taxes (taxes are monthly and not attributable to one operation).
- **Taxes** (`MonthlyTax`, `month` as `YYYY-MM` of the closing fill's session). `stockSales` is
  the gross value of stock sells in the month; `stockGain` and `optionGain` are the net realized
  gains on stock and option closes. A month is exempt when
  `stockSales <= monthlyStockSalesExemption`; then `exemptGain = max(stockGain, 0)` and the stock
  result is dropped entirely (gains are exempt, losses do not offset option gains), otherwise
  `exemptGain = 0` and the whole `stockGain` is taxable. `netGain = taxableStockGain + optionGain`
  and `tax = max(netGain, 0) * incomeTaxRate`; no loss carry-forward (ADR-0004). An exercised or
  assigned option folds its premium into the stock price with no separate option gain: an
  assigned covered call is a stock sale at strike plus premium, an exercised long call a stock
  purchase at strike plus premium, an exercised long put a stock sale at strike minus premium, an
  assigned short put a purchase at strike minus premium. Tax for month M is deducted from cash on
  the last session of month M+1; tax not yet deducted at `period.to` is deducted on the final
  session.
- **Equity and metrics.** `EquityPoint.equity` is cash plus the mark of every open position at
  the session close; `drawdown = 1 - equity / runningPeak`, zero at a new peak, where
  `runningPeak` starts at `initialCapital` and is the largest equity seen so far (so a run that
  never rises above its initial capital reports the drawdown from that capital). Daily simple
  returns are `r_t = equity_t / equity_(t-1) - 1` (the first against `initialCapital`); the
  risk-free rate per session is `rf_t = (1 + cdi_t)^(1/252) - 1` from the CDI point visible at
  that close. Then `totalReturn = equity_last / initialCapital - 1`;
  `cagr = (equity_last / initialCapital)^(252 / sessions) - 1`;
  `sharpe = mean(r_t - rf_t) / sampleStdev(r_t - rf_t) * sqrt(252)`, `null` when the standard
  deviation is zero; `maxDrawdown` is the largest `drawdown`; `exposure` is the fraction of
  sessions with at least one operation held at the close. `winRate` and `profitFactor` are
  computed over the **settled operations**: those `expired`, plus those `closed` with a reason
  other than `period_end`; operations closed by `period_end` are excluded because their `pnl` is
  a mark, not a result. `winRate` is settled operations with `pnl > 0` over settled operations,
  `null` when none settled; `profitFactor` is gross wins over gross losses of settled
  operations, `null` when there are no losses; `fees` is the sum of
  `Fill.costs`, `taxes` the sum of `MonthlyTax.tax`, `slippage` the sum over option fills of
  `|price - reference| * quantity`, informational only (it is already inside `Fill.price`).
  `cagr` and `sharpe` are `null` with note `short_window_not_annualized` when the run has fewer
  than 126 sessions. `cagr` alone is `null` with note `non_positive_equity` when
  `equity_last <= 0` (the power has no real value); `sharpe` is unaffected by that case.
- **Walk-forward** (ADR-0014 Q37) cuts the period into consecutive windows of `windowSessions`
  sessions from `period.from` (the last may be shorter) and reports the metrics above per
  window, computed on that window's slice of the equity curve; an operation belongs to the
  window where it opened. There is no optimization and the windows are not out-of-sample; they
  show instability of one strategy version over time.
- `seed` is the only entropy; nothing in v1 consumes it, and it is part of the config so that
  any future consumer stays reproducible.

#### `markToMarket`, `proposeSettlement`, `score`, `impliedVolatilityIndex`, `dataWindow`

- **`markToMarket`**: `totals.equity = cash + sum of position values`, position values being
  price times signed quantity (a net short position has a negative value); operations are an
  attribution view over the same fills and never add to totals. A series with no trade that
  session is marked at its last trade with `stale` set and `fairValue` alongside (ADR-0014 Q42).
- **`proposeSettlement`** takes the expiry from `operation.expiry`; an operation with
  `expiry: null` has nothing to settle and is `invalid_input` (path `operation.expiry`). It
  exercises or assigns any option leg in the money at that expiry session's close by any amount
  (ADR-0014 Q41); stock legs are `kept`. The outcome is constrained by the leg: a stock leg is
  `kept` with `intrinsicValue: null`; a long option leg is `exercised` or `expired_worthless`; a
  short option leg is `assigned` or `expired_worthless`; option legs always report their
  `intrinsicValue` (zero when worthless). `fills` are the stock fills the outcome implies, at the
  strike: empty for `kept` and `expired_worthless`, one stock fill for `exercised` (buy for a
  call, sell for a put) and for `assigned` (sell for a call, buy for a put). The proposal never
  becomes a fill on its own; the user confirms or corrects (ADR-0014 Q41).
- **`score`** follows ADR-0005 as amended by ADR-0014. `confidence` is a `Confidence` scalar, so
  the `[0, 1]` range is the schema's, not the engine's, to check. The P&L part is a union that
  encodes the dependent nullability: without an `operation` (a strategy-version analysis, or a
  decision on no operation) `pnl`, `maxLoss` and `normalizedPnl` are all `null` together with
  note `no_operation`, `counterfactualPnl` is `null`, `realizedFills` must be empty, and the score
  is the thesis component only. With an `operation`: `pnl` is its P&L between `decidedAt` and the
  horizon session close from `realizedFills` plus marks; `maxLoss` is the operation's;
  `normalizedPnl` is `pnl / maxLoss`, and is `null` exactly when `maxLoss` is `"unbounded"`
  (note `unbounded_max_loss`), `0` (note `zero_max_loss`) or `null`; the first and last cases are
  the type's, the zero case is a rule the type cannot express. The thesis part is `{ claim: null }`
  without a claim (note `no_thesis_claim`), or the claim with `held` and
  `brier = (confidence - held)^2`, `held` as 1 or 0; `held` and `brier` exist only with a claim.
  `counterfactualPnl` is set for `do_not_enter` only, using `origin` to choose the exit rule.
- **`impliedVolatilityIndex`** (`atm_30d_variance_interpolated`): for each of the two listed
  expiries bracketing 30 calendar days from the session of `at` (`T1 <= T30 <= T2`, `T1 < T2`,
  all in the engine's years), the at-the-money volatility is the implied volatility of the call
  and the put with strike nearest the forward `F = spot * e^((r - q) * T)`, averaged when both
  are visible; the index is `sqrt((w * s1^2 * T1 + (1 - w) * s2^2 * T2) / T30)` with
  `w = (T2 - T30) / (T2 - T1)` (linear in total variance). `T30` is `(n + (1 - f)) / 252`, the
  same exact-tenor basis `resolveTimeToExpiryYears` gives every bracket (`n` whole sessions to
  the date 30 calendar days ahead plus the fraction `f` of the session of `at` already elapsed):
  a whole-session count here bracketed the same view differently at a session's open than at its
  close (PR #53 round 3 item 2). An expiry exactly at 30 days
  is used alone. `impliedVolatility` is `null` with note `iv_index_not_bracketed` when fewer
  than two expiries bracket 30 days or no ATM volatility can be solved. Ingestion persists the
  result so `iv_rank` reads it back from `MarketView.impliedVolatilityIndex`.
- **`dataWindow`** is synchronous and needs no view: from the strategy it derives lookback per
  timeframe, whether a chain, macro rates, corporate actions or the implied-volatility index are
  needed, and uses the calendar to turn candle counts into `from`. `to` is `at`. `candles`,
  `corporateActions`, `macro` and `dividendYields` are always requested, not gated by the
  indicators or the structure's legs: `evaluateStrategy` prices its own stock-only proposals with
  `priceStockLegs`, which reads `cdi` and the underlying's dividend yield regardless of whether
  the structure carries option legs. A structure with a leg whose `role` is not `stock`
  additionally requests `optionSeries` and `optionPrices` (the chain), regardless of what the
  entry/exit/adjustment conditions read.
  - **Anchor.** The lookback is computed from `since` when present, else from `at` (`since ??
at`); the anchor session is the last calendar session whose `open <= anchor`. This lets a
    caller ask for the window a batched `evaluateStrategy(since, at]` run needs, which is the
    window the earliest evaluation instant (`since`) needs, not the latest (`at`).
  - **Per-session candle count.** Every session contributes `floor((session.close - session.open)
/ timeframeMinutes)` of its own candles, minimum 1 — its own open/close, not the anchor
    session's, so a half-day (early close) session contributes fewer candles than a full one and
    the walk below never overcounts it. Each prior session (strictly before the anchor session) is
    assumed fully closed and contributes its own full count this way.
  - **Candles already closed in the anchor session.** `min(candlesPerSession(anchorSession),
max(0, floor((min(anchor, anchorSession.close) - anchorSession.open) / timeframeMinutes)))` —
    the candles of the anchor session that have already closed by the anchor instant, clamped to
    the anchor session's own candle count so an anchor hours after that session's close (or a
    half-day anchor session) never reports more closed candles than the session actually has; a
    forming candle never counts. For `D1`, the anchor session contributes one closed candle
    exactly when `session.close <= anchor`, zero when the anchor falls mid-session (a daily candle
    is not observable before its session closes).
  - **Warm-up multiplier.** The candle count requested per indicator is `length` for `sma`,
    `3 * length` for the recursive indicators (`ema`, `rsi`, `atr`; see "Indicators" above), 1 for
    `iv_rank` (its lookback is a session count, tracked separately). `dataWindow` walks sessions
    backward from the anchor, each contributing its per-session candle count (per the two rules
    above), until the running total covers the largest requested count across every indicator the
    strategy references.
  - **`iv_rank`'s lookback** is independent of the candle-count walk: the anchor session
    contributes an IV point only if it has closed by the anchor (`anchorSession.close <= anchor`,
    the same test used for the `D1` candle rule above); when it has, the walk reaches back
    `lookbackSessions - 1` further sessions from the anchor session; when it has not (the anchor
    falls mid-session, so the anchor session's own point is not yet visible), the walk reaches back
    `lookbackSessions` further sessions instead, so the window still contains `lookbackSessions`
    closed points. Either way it is a session count, not a candle count, and the two walks (candle
    and `iv_rank`) combine by taking whichever reaches further back.
  - **`from`** is the close of the session immediately preceding the earliest needed session, so
    every candle of that session has `asOf > from` (a candle's `asOf` is its close, always after
    its session's open); when the earliest needed session is the calendar's first session (no
    preceding session), `from` falls back to that session's `open`, which still satisfies `asOf >
from` for every candle in it.
  - **Calendar clamp.** `Math.max(0, ...)` on the earliest needed session index: a calendar
    shorter than the lookback yields a shorter window than requested, not a negative index or a
    thrown error; callers see `insufficient_data` from the computing method (`indicators`,
    `evaluateStrategy`, ...) when the window turns out too short to seed an indicator, not from
    `dataWindow` itself, which never fails. When no calendar session opens at or before the
    anchor but the calendar is non-empty (`since` reaches back before the calendar's first
    session), `from` falls back to that first session's `open`, not to `at`; `at` is the fallback
    only when the calendar is empty, since there is then no session to anchor to.

### Error union

`EngineError` is the complete list of whole-call failures: `invalid_input` (semantic, after Zod),
`unsupported` (a `kind` the contracts allow but the engine does not implement; see
`capabilities()`), `missing_instrument`, `insufficient_data` (naming the `DataWindow` that would
suffice), `no_series_matches`, `degenerate_strikes`, `unsizeable`, `checkpoint_mismatch`. Anything
else that can go wrong is a `null` field with a `Note` on the item or a `Note` on the artifact. A
thrown exception from the engine is a bug.

### Ordering constraints

Arrays in `MarketView` may arrive in any order; the engine sorts (I3). Duplicate keys (same
ticker, timeframe and `asOf` for candles; same ticker and `exDate` for corporate-action factors;
same ticker and session for option prices; same series and date for macro points) are
`invalid_input`. A duplicate `(ticker, asOf)` in `optionSeries` is a narrower case: it is not
rejected, because a legitimate re-listing (a strike adjustment, a superseded expiry) always
advances `asOf`, so a true tie on `(ticker, asOf)` is data noise, not a signal the caller needs
surfaced; it resolves deterministically to the lower-strike row regardless of array order (PR
#53 round 4 item 4). `since < at`. `resume.configDigest` must equal the digest of `config` and
`resume.engineVersion` must equal `ENGINE_VERSION`, else `checkpoint_mismatch`; the caller
restarts the run from `config` (runs are immutable anyway). `calendar` must cover every session a
call touches, else `insufficient_data`. `MarketView.dataVersion` and `datasetNotes` are copied
into `provenance` unchanged (`null` and `[]` when absent).

### Invariants

Each invariant is a property test in `packages/engine/src/invariants/`, written with `fast-check`
and landing with the first implementation ticket that makes it testable.

- **I1 Future-blind** (`i1-future-blind.property.test.ts`): for every method and every
  evaluation instant `c` inside it (the call's truncation instant, each close in `(since, at]`
  for `evaluateStrategy`, each session close for `runBacktest`, the horizon close for `score`,
  the expiry close for `proposeSettlement`), appending rows with `asOf > c` to the view never
  changes the artifact computed at `c`; rows later than the call's truncation instant appear in
  `provenance.truncated`. In particular, appending a corporate-action factor whose ex-date
  session opens after `c` never changes an artifact computed at `c`, and one whose ex-date
  session opens at or before `c` adjusts every candle before its ex-date at every evaluation
  instant inside that session alike.
- **I2 Chunk-invariance** (`i2-chunk-invariance.property.test.ts`): any sequence of `runBacktest`
  calls with any `maxSessions` values and their checkpoints yields a `BacktestRun` deep-equal to
  one uninterrupted call modulo `provenance.truncated`: the truncation report depends on the view
  slice each chunk receives, so the property test compares the runs with `truncated` stripped.
- **I3 Order-invariance** (`i3-order-invariance.property.test.ts`): any permutation of any
  `MarketView` array yields a deep-equal artifact.
- **I4 Determinism** (`i4-determinism.property.test.ts`): identical inputs yield deep-equal
  artifacts; the engine reads no clock, environment or `Math.random`; `seed` is the only entropy.
- **I5 Numeric discipline** (`i5-numeric-discipline.property.test.ts`): every `Centavos`,
  `Quantity`, `SignedQuantity` and `tradedQuantity` in an artifact is an integer, `Quantity`
  positive and `SignedQuantity` non-zero; every `DecimalString` is
  canonical at ADR-0001 scales (prices 2, greeks, volatilities and ratios 6);
  `JSON.parse(JSON.stringify(x))` is the identity on every artifact.
- **I6 Provenance** (`i6-provenance.test.ts`): every artifact carries `provenance.engineVersion`
  equal to `ENGINE_VERSION`, the pricing model, the truncation report, the view's `dataVersion`
  and `datasetNotes`, and a `Note` for each approximation applied (`european_pricing` per
  ADR-0002, `intraday_option_fill_at_fair_value` and `short_window_not_annualized` per ADR-0011).
- **I7 Prefix-consistency** (`i7-prefix-consistency.property.test.ts`): a run over `[from, D]`
  and a run over `[from, to]` with `to > D` produce identical fills and equity curve up to and
  including session D, and identical operations except those still held at D's close: the
  shorter run closes them with reason `period_end` at that close's mark (no fill, no cost, so
  equity at D agrees modulo the period-end tax sweep), the longer run carries them on. `D` being
  the shorter run's own `period.to` finalizes and deducts that month's tax there even when the
  month is not yet over, which the longer run only does at the month's real last session — the
  two only disagree on `equity`/`cash` at `D` when that month already has a non-zero stock gain
  or sale by `D`, and only by exactly that tax. A checkpoint paused at cursor D carries no
  information from rows with `asOf` later than D's close.

An eighth test, `capabilities.conformance.test.ts`, asserts that every `kind` reported by
`capabilities()` is a member of the matching `contracts` enum and that every member of those
enums is either reported or explicitly listed as unsupported.

### Change policy

Additive changes are allowed without a new ADR: new optional input fields, new fields on
artifacts, new `NoteCode`, `EvaluationOutcome` and `MissedEntryReason` members, new `kind`s in a
contracts vocabulary (schema, engine code, capabilities and tests together). Every closed union
the engine declares has an `as const` array beside it, and `api.test.ts` asserts that each array
enumerates its union exactly, so adding a member means adding it to the type, the array and the
test in one change; the arrays are what `capabilities()`, the UI and the AI prompts iterate
over. Renames, removals,
signature changes, new or removed methods, changes to the visibility rule or to the meaning of an
existing field require a superseding ADR. `ENGINE_VERSION` bumps its minor on additive change and
its major on a superseding ADR; checkpoints are valid only for the version that produced them.

The `money` module exports (`Money`, `add`, `subtract`, `formatBRL`, `NonIntegerAmountError`) were
legacy and outside this interface, existing only because the `apps/web` placeholder page rendered
`formatBRL`. Issue #8 removed them from `packages/engine`; `apps/web` now formats currency with its
own pt-BR formatter (`apps/web/src/lib/format/brl.ts`), and nothing outside this package may import
money helpers from `@fetha/engine`. Issue #14 landed the first computation (`capabilities()`,
`dataWindow()` and `indicators()`, with SMA, EMA, Wilder RSI, Wilder ATR and `iv_rank`), so the
coverage gate is live from that ticket on, not vacuous.

### #21 addendum: `priceOperation`, `impliedVolatilityIndex` and the option-pricing seam

Issue #21 implements `priceOperation` in full (concrete legs and `LegSelection`, strike and
expiry selection, sizing) and `impliedVolatilityIndex`, landing the option-pricing seam this ADR
describes above ("Rates, time and greeks", "`priceOperation`", "Indicators", "`markToMarket`, ...
`impliedVolatilityIndex`"). Review round 1 (PR #53) surfaced gaps the sections above left
implicit or wrong; this addendum records what shipped and the rules that came out of the fix.

- **BSM/IV on doubles at the `black-scholes.ts` seam.** ADR-0001 fixes decimal arithmetic for
  prices, greeks and money everywhere the engine's public types are concerned; it does not reach
  into a pricing model's internal numerics. `black-scholes.ts` and `implied-volatility.ts` compute
  entirely in `number` (decimal.js has no closed-form normal CDF/PDF, and Abramowitz & Stegun
  7.1.26 on doubles is far below the 6-decimal-place scale a `DecimalString` reports at), and
  convert to `Decimal` only at `option-pricing.ts`'s `priceOptionLeg`, the one seam between this
  model and the rest of the engine. That seam now guards non-finite output as a last line (a
  non-positive spot/strike is rejected earlier, at `invalid_input`, so this is defense in depth,
  not the primary check) rather than let `toDecimalString`'s finiteness invariant throw out of
  `priceOperation`.
- **Selection tie-breaks are deterministic.** Nearest-strike and nearest-|delta| selection (both
  `nearest` and `delta` `StrikeSelection` kinds) break an exact tie by the lower strike, then the
  lexicographically earlier ticker, never by which candidate a `MarketView` array happens to list
  first: `MarketView.optionSeries`/`optionPrices` order is not meaningful (I3), so a caller that
  reshuffles rows before calling must resolve the same operation. Nearest-|delta| selection also
  now prices every candidate through the same mid/last/close/average ladder pricing itself uses
  (`resolve-market-price.ts`, shared by `price-operation.ts` and `resolve-leg-selection.ts`)
  instead of a `.find` over `optionPrices` alone, so a selection and its own pricing a moment
  later never disagree over which price was "current." On a shared strike rank (a straddle),
  the two rights disagree exactly at asymmetric delta targets; the governing delta is the
  first right the structure declares at that rank, never a best-of-both or an average, since
  both legs must land on one strike.
- **Time-to-expiry failure is not silently `t = 0`.** A concrete option leg whose listed expiry
  precedes the session of `at` is `invalid_input` (path `legs.expiry`); one the calendar does not
  cover (neither `at` nor the expiry date has a session) is `insufficient_data` for `candles`.
  `resolveLegSelection`'s own time-to-expiry lookup for the strike it already chose cannot fail by
  construction (the chosen expiry already passed the `business_days` window check against the
  calendar), so its former silent-zero fallback is an `invariant` now, not a code path a test can
  reach with well-formed data.
- **Concrete legs are validated as one operation.** `resolveLegSelection` builds a
  consistent set of legs by construction; a caller-supplied `LegInput[]` does not. Every
  stock leg must share the underlying inferred for the operation (the first stock leg's
  ticker, or the first option leg's listed underlying); every option leg must share one
  listed expiry — both `invalid_input` (path `legs`). A leg with no listed series is still
  `missing_instrument`, reported by its own valuation, not by this check.
- **Sizing: `zero_units` and the net-credit divisor.** `UnsizeableReason` gains `zero_units`
  (additive, `api.ts` and the frozen block above updated together): a `SizingRule` that would
  otherwise size to fewer than one unit is unsizeable, per "Quantity" above ("fewer than one
  unit is unsizeable") — it is never clamped up to one unit, the bug round 1 found. A
  `fixed_fractional` quantity on a net-credit structure (`netPremium > 0`, premium received)
  sizes against the structure's bounded max loss, not the premium received, which understated the
  capital actually at risk on a credit spread; an unbounded max loss on a net-credit
  `fixed_fractional` structure is `unsizeable` (`unbounded_max_loss`), the same reading
  `fixed_risk` already gave a naked short option. `zero_units` currently conflates two
  distinct reasons — a genuinely zero max loss or premium, and a positive per-unit cost the
  declared capital and fraction cannot afford one unit of — pending a `UnsizeableReason`
  member for the unaffordable-budget case
  ([issue #59](https://github.com/fernandolisboa/fetha/issues/59)).
- **Spot precedence matches leg precedence.** The underlying's own spot and a leg's own price
  both resolve `mid` (bid/ask average) before `last`, `last` before a day's `close`, `close`
  before `average` — one ladder, not two, so a leg that happens to be the underlying itself prices
  the same way whether it is read as "the spot" or "a leg."
- **`risk_free_rate_defaulted`.** A visible `cdi` point's absence is now a note (additive
  `NoteCode`, `api.ts` and the frozen block updated together) alongside the existing
  `dividend_yield_defaulted`, so a caller can tell the continuous rate was assumed zero rather
  than read from `MarketView.macro`. An `annualRate`/`annualYield` at or below -1 (which would
  make the continuous-rate conversion's `ln()` throw) is `invalid_input` before conversion.
- **`iv_not_converged` also covers a spuriously "matched" price.** A price within
  `PRICE_TOLERANCE` (1e-8) of the model's price at some sigma is not, on its own, evidence
  that sigma is pinned by the price: deep in/out of the money near expiry, price is
  near-flat across almost the whole `[1e-4, 5]` sigma domain, so bisection can satisfy the
  tolerance inside a bracket that never meaningfully narrowed. `solveImpliedVolatilityRaw`
  now also requires, at the accepted sigma: local vega ≥ 1e-3 (raw, pre-scaling), and the
  price spanned by the accepted bracket's own endpoints (`|price(high) - price(low)|`) ≥
  1e-4. Both thresholds sit two orders of magnitude below well-conditioned fixtures
  (vega ~5-10, bracket price width ~0.8-1.5) and two above the near-intrinsic case the
  fix's test uses (vega <1e-3, bracket price width <1e-4).
- **`impliedVolatilityIndex` is implemented**, per "`markToMarket`, ..., `impliedVolatilityIndex`,
  `dataWindow`" above: `atm_30d_variance_interpolated`, bracketing the 30-calendar-day point
  between the two nearest listed expiries (or using one that lands on it exactly) and
  interpolating linearly in total variance. `markToMarket` and `proposeSettlement` are still
  unimplemented, but no longer misreport `"pricingModels"` as the reason (BSM is implemented, by
  `priceOperation` and now `impliedVolatilityIndex`); they report `"adjustmentRules"` instead
  (`capabilities().adjustmentRules` is genuinely empty), with `unsupportedAdjustmentRuleKinds[0]`
  as the `kind`, the same pattern `score()` already used for `thesisClaims`.
- **A sizing preview values legs, not a whole operation.** `resolveSizingUnits` used to call
  the same `priceConcreteLegs` a real pricing pass calls, built a full `OperationPricing`
  around it with an empty, fabricated `Provenance`, and — because `priceConcreteLegs`
  resolved the risk-free rate and dividend yield itself — resolved both a second and (once
  more, for the final pricing pass) a third time in one `priceOperation` call over a
  `LegSelection`. `valueLegs` now does exactly the per-leg valuation, notes and net premium
  a preview or a full pricing pass shares; `resolveOperationRates` resolves the rate and
  yield once per call and both `priceSelection` and the concrete-legs path thread the
  result through `resolveSizingUnits` and `priceConcreteLegs` rather than re-resolving.
- **Scope still stops at `priceOperation`.** Strike and expiry selection are implemented for
  `priceOperation` only; `evaluateStrategy` still refuses any structure with a non-`stock` leg
  with `unsupported` (`strikeSelections`), per the "Stock-only scope (#15)" note above, until #23.

### #16 addendum: `runBacktest` for stock-only strategies

Issue #16 implements `runBacktest` for the same stock-only subset #15 implements in
`evaluateStrategy`, and reuses `evaluateStrategy` itself as the sole source of entry and exit
decisions inside the run: each session's signals come from one `evaluateStrategy` call at that
session's close, with the run's own `openOperations` and a synthetic `riskProfile` whose
`declaredCapital` is the run's current equity (never the config's, per "Sizing and risk" above).
`runBacktest` is therefore a scheduler and accounting layer around the evaluator, not a second
decision engine, so live and backtest reconcile by construction rather than by parallel
implementation. Gaps the "Semantics" section above left implicit, resolved conservatively:

- **Daily-only in v1.** The "Fills" section describes both a daily and an intraday fill model, but
  intraday fills need option fair-value pricing (`fair_value`, ADR-0011/ADR-0014) that #21 has not
  landed yet, and stock-only intraday backtesting was not asked for by this ticket. `runBacktest`
  refuses any `strategy.definition.timeframe !== "D1"` with `invalid_input` at
  `config.strategy.definition.timeframe`, naming the v1 daily-only scope: the timeframe is a
  scheduling restriction this ticket imposes, not a `kind` `capabilities()` reports as a vocabulary
  member, so `unsupported` (reserved for a member `capabilities()` names and then refuses) is the
  wrong code here. Lifting this is additive (a new fill path, no signature change) once #21 lands.
- **Exit-fill retry has no cap, and a stranded entry retry is finalized at `period.to`.** These
  are permanent rules, not #16-scope stopgaps, so they are recorded in ADR-0014 as Q52 and Q53
  rather than here.
- **A calendar month gap never leaves a tax deduction unpaid.** The deduction scheduled after a
  month finalizes is paid on that month's own last session in `periodSessions` — whichever
  session follows it in the run, gap or not — so a month transition never finds one still
  pending, real ANBIMA calendar or a synthetic gap alike; `run-backtest.ts` asserts this as an
  invariant rather than guarding it defensively.
- **v1 has no cash constraint.** Sizing already keeps an entry inside the run's current equity,
  but costs, slippage and taxes are charged on top of it and can still push `cash` below zero
  (a large fixed brokerage fee against a small position, for instance). A run does not refuse or
  clamp this; it is recorded once, additively, as note `negative_cash` on the run
  ("cash went below zero during the run; v1 has no cash constraint") when any `EquityPoint.cash`
  in the run is negative. A margin or buying-power constraint is a future ticket, not a #16 gap.
- **A non-positive equity is clamped to a positive sizing budget, not refused.** The synthetic
  `riskProfile.declaredCapital` fed to each session's `evaluateStrategy` call is
  `max(equity, 1)`: `declaredCapital` is a `Centavos` and cannot be zero or negative, and a run
  whose equity has gone non-positive must still be able to call `evaluateStrategy` for the
  remaining sessions rather than fail outright. The run records this once, additively, as note
  `non_positive_equity` on the run ("equity was non-positive at least once during the run and was
  clamped to a positive sizing budget") whenever the clamp changed the value at least once.

### #25 addendum: `markToMarket` and `proposeSettlement`

Issue #25 implements both remaining stubbed methods. Neither needed an additive change to
`api.ts` or a new ADR: every type both methods return (`PortfolioValuation`, `OperationValuation`,
`PositionValuation`, `SettlementProposal`, `LegSettlement`) was already frozen. This addendum
records the semantic decisions the frozen types and ADR-0014 left open.

- **`markToMarket` composes, never re-implements.** Both methods reuse the `priceOperation` seam:
  `priceLegsAt` (`price-operation.ts`, the resolve-spot/resolve-rates/`priceConcreteLegs` glue
  `priceOperation`'s own concrete-legs branch uses) is called on an `Operation`'s own legs (mapped
  to `LegInput`, entry prices dropped) at the mark instant, giving each operation's
  `OperationValuation.pricing` through the exact same mid/last/close/average ladder, stale-mark
  (Q42) and fair-value logic a `priceOperation` call gives. Nothing in `mark-to-market.ts`
  computes a price, a greek or a payoff on its own.
- **Operation coherence is checked once, shared.** ADR-0013's "Operations, positions and strategy
  versions" says the engine checks `Operation.expiry` coherence wherever an `Operation` comes in;
  `markToMarket` (`operations[i]`) and `proposeSettlement` (`operation`) now share one
  `validateOperationCoherence` (`internal/operation-coherence.ts`): a stock-only operation must
  carry no expiry, an operation with option legs must carry one, every stock leg's ticker must
  equal the operation's `underlying`, every option leg whose series is visible in the view
  (`resolveSeries`, at the same instant the caller is truncated to — `at` for `markToMarket`, the
  expiry session close for `proposeSettlement`) must list that same underlying, expiry and the
  leg's own role as its right, and the operation cannot have been opened after that same instant
  (round 1 item 7; skipped when the calendar does not cover it, since `markToMarket` already
  fails the whole call with `insufficient_data` in that case — round 1 item 8). A leg whose series
  simply is not visible is not rejected here; it surfaces later as that leg's own
  `missing_instrument`. `evaluateStrategy`'s own coherence checking (ADR-0013 "Entry gating")
  stays separate until #23: it never receives a caller-supplied `Operation` to validate this way,
  only ones it built itself.
- **Unrealized P&L is computed per leg, on the entry price's own scale.** For each operation leg,
  the mark used is `pricing.legs[i].price ?? pricing.legs[i].fairValue`; a leg with neither
  (`no_market_price` with no solvable fair value, already noted on `pricing`) contributes zero
  unrealized P&L, since `OperationValuation.unrealizedPnl` is a plain `Centavos`, never `null` —
  there is no honest non-zero number to report and no field to carry an "unknown" flag on. Every
  leg's own effective quantity and entry price are rebased across a corporate-action factor per
  ADR-0014 Q51 (PR #55) — not just the stock leg's, since an option leg's own ticker naturally
  carries no factor (a split forces a series rollover, out of scope for both this ticket and
  #23) and the same rebasing therefore leaves it untouched. `unrealizedPnl` is
  `sum(sign(side) * effectiveQuantity * (markOnEffectiveScale − effectiveEntryPrice))` in
  centavos. An operation whose listed expiry has already passed by the mark session is not
  rejected outright (round 1 item 3): its option legs are valued at intrinsic (the underlying's
  own close at the expiry session, the same instant `proposeSettlement` uses) with note
  `settlement_pending`, so the portfolio can still be marked on any day after an expiry the user
  has not yet confirmed a settlement for.
- **Totals come from positions only, greeks included.** ADR-0013 already says
  `totals.equity = cash + sum(position values)` and that operations are "an attribution view ...
  and never add to totals"; this addendum extends the same rule to `totals.unrealizedPnl` (also
  summed over `positions` only) and to `totals.greeks.delta`, for the same double-counting reason
  — a stock leg opened through a tracked `Operation` is expected to also appear in `positions`.
  `delta` sums every priced position's own signed quantity (a stock position's delta is always 1
  per share regardless of role, strike or expiry) plus every operation's own _option_-leg deltas
  only, never a stock leg's (round 3 item 3, superseding an earlier round 1 draft of this
  paragraph that summed every operation's whole `pricing.greeks.delta`, stock legs included, and
  so double-counted a ticker held both ways). The other four greeks have no stock-leg
  contribution to begin with, so summing every operation's own aggregate `pricing.greeks` for
  them is unaffected by this restriction; they stay operations-only, the only artifact in the
  call with the structured leg information they need. `PortfolioValuation.limitBreaches` flattens
  each operation's own per-operation limit breaches (`maxLossPerOperation`,
  `maxExposurePerOperation`, `maxPremiumBought`); `maxOpenOperations` is reported at most once at
  the portfolio level instead (round 1 item 4), since every operation's own pricing call checks
  it against the same `operations.length - 1` and would otherwise report the identical breach
  once per operation.
- **A standalone `Position` is priced through the same market-price ladder as a leg,
  never rebased.** `PositionValuation` uses `resolveLegMarketPrice` (mid/last/close/average,
  `stale` when the price row's session precedes the mark session, Q42) exactly as a leg would;
  `value = price * quantity` and `unrealizedPnl = (price − averageCost) * quantity`, both correct
  for a short position because `quantity` is already signed (`SignedQuantity`). `Position` carries
  no `openedAt`, so — unlike an `Operation` leg — its `averageCost` is never rebased by a
  corporate-action factor here; keeping a position's average cost on the current scale as splits
  occur is the caller's responsibility on ingestion, not this call's.
- **`proposeSettlement`'s in-the-money test reads the underlying's own nominal close on the
  expiry session,** resolved by `latestVisible` (asOf ≤ the expiry session's close, latest wins)
  rather than the first array match, so a same-session candle revision resolves the same way
  regardless of `MarketView.candles` order (I3) and a revision published after the expiry close
  stays invisible to the proposal (I1) — the same reasoning `resolve-series.ts` already documents
  for a re-listed option series. `sessionByDate` (`internal/calendar.ts`) resolves the exact
  `TradingSession` for `operation.expiry`, distinct from `sessionAtOrBefore`'s "last session at or
  before an instant": `proposeSettlement` receives no `at`, only the operation's own `expiry`
  date, and needs that session's own close as the truncation instant. When the calendar has no
  `TradingSession` for that date at all, `insufficient_data` names a midnight-UTC instant on that
  date purely as an informational hint for the caller to fetch, since resolving a real instant is
  exactly what is missing; when the calendar does cover the session but no candle is visible for
  it, the window is that session's own `open..close` instead (round 1 item 10), a real, resolvable
  window rather than the same placeholder.
- **Settlement outcome and fills follow ADR-0014 Q41 exactly**: in the money by any amount at the
  expiry close, mirroring B3's automatic exercise; a stock leg is always `kept`; a long option leg
  is `exercised` or `expired_worthless`; a short option leg is `assigned` or `expired_worthless`;
  every option leg reports `intrinsicValue` (zero when worthless), never `null`. The one fill a
  non-worthless option leg implies is priced at the strike, dated at the expiry session's close,
  with zero cost (`Fill.costs`): a settlement proposal is not itself a trade, it is what the user
  confirms or corrects before one is recorded (ADR-0014 Q41), so no B3 fee or brokerage applies
  yet, noted as `settlement_costs_not_modeled` whenever at least one leg actually proposes a fill
  (round 1 item 10). Multiple legs of a covered structure (a covered call, a vertical) each settle
  independently; netting the resulting stock fills into the structure's own position, and
  attributing the residual, is a `runBacktest`/`portfolio` concern (ADR-0013 "Settlement in a
  run"), not this proposal.
- **Round 1 hardening, briefly.** `resolveLegMarketPrice` gained a `stock` rung (the latest
  visible D1 candle close, stale per Q42) alongside the existing `optionPrices` ladder, since a
  stock ticker never appears in `optionPrices` (item 1). `markToMarket` and `proposeSettlement`
  now share `validateViewIntegrity`, rejecting a duplicate calendar date or a duplicate
  `(ticker, timeframe, asOf)` candle as `invalid_input`, since `sessionByDate`,
  `sessionAtOrBefore` and `latestVisible` all resolve such a tie by array order otherwise (item
  11); `splitFactorProduct` returns a `Result` and rejects a non-positive corporate-action factor
  the same way, shared with `evaluate-strategy.ts`'s exit-rule rebasing (item 8). Two `NoteCode`
  members are additive: `settlement_pending` (an operation valued at intrinsic past its own
  expiry) and `settlement_costs_not_modeled` (a settlement proposal's fill costs).
- **Round 3 hardening, briefly.** An operation's own expiry session is only actually expired
  once that session's own close has passed: `markToMarket` treating the whole session as expired
  from its open read the expiry candle before it was visible at `at`, a look-ahead (I1, round 3
  item 1); the intrinsic path now gates on `at >= expirySession.close`. A stock leg's own
  corporate-action factor can dissolve its effective count (`quantity / F`) below one unit
  (an odd lot across a grouping) or, for a near-zero `F`, past a safe integer; the latter is
  `invalid_input`, the same as `runBacktest`'s own guard, and the former excludes the leg from
  `pricing.legs` and the aggregate greeks/payoff (there is no `Quantity` below one to give it)
  while still folding its residual value into `unrealizedPnl` on the unrounded effective
  quantity, noted with the additive `less_than_one_effective_unit`; every leg's own
  `unrealizedPnl` contribution now always uses the unrounded effective quantity, matching
  `runBacktest`'s own P&L (Q51 — "the effective count is never rounded mid-run"), not just the
  dissolved ones (round 3 item 2). `totals.greeks.delta` summed both `operations[].pricing.greeks`
  (which already includes each operation's own stock legs) and every position's own quantity —
  double counting a ticker held both ways; delta now sums only priced positions' own quantity
  plus every operation's option-leg greeks, stock legs excluded (round 3 item 3). A resumed
  `runBacktest` chunk could fill or mark against a view whose `corporateActions` had never been
  validated by `evaluateStrategy` in that same session, reaching `splitFactorProduct`'s
  now-actually-reachable invariant; `runBacktest` validates `view.corporateActions` positivity
  itself, upfront, before its own session loop (round 3 item 4). An expired operation whose
  expiry candle was still missing at the mark session aborted the whole `markToMarket` call, the
  same failure round 1 item 3 already fixed for a missing calendar session; a missing candle on
  an otherwise-known session instead excludes just that operation's own option legs (a stock leg
  never consults this basis) from `pricing.legs` and the aggregate greeks/payoff, notes
  `no_market_price` and folds zero into `unrealizedPnl`, leaving the rest of the operation and
  every other operation in the same call to value normally (round 3 item 5). A per-leg
  `settlement_pending` note never surfaced on `OperationPricing.notes` itself, only on the leg
  that carried it; `priceConcreteLegs` now aggregates it at the operation level next to
  `no_market_price`, the same way (round 3 item 6). `validateViewIntegrity` covers a duplicate
  `optionPrices` `(ticker, asOf)` row too, the same tie-by-array-order hazard round 1 item 11
  already fixed for `calendar` and `candles` (round 3 item 7).

## Considered options

- **A, minimal**: two functions (`compute(view, query)` and `step(view, input, budget)`) over a
  query union and a caller-assembled view. Highest leverage per entry point and language-agnostic
  by construction, but the real interface is the query union, the conditional return type hurts
  error messages, and ordering was rejected rather than normalized. Kept from A: legs-or-selection
  pricing, batch evaluation with `since`, the truncation report.
- **B, flexible**: eleven methods over a `MarketDataset` with the `asOf` visibility rule,
  vocabularies as `kind` unions reported by `capabilities()`, `inputsDigest` provenance, separate
  `instantiate`, `analyzeStructure` and `walkForward` methods, a `Money` object with currency.
  Best look-ahead story and extension path; too many methods for the common callers, a walk-forward
  optimizer the DSL cannot feed, and `inputsDigest` costs a hash of the whole view per call. Kept
  from B: `asOf` on every row, `capabilities()` with a conformance test, `configDigest`
  checkpoints with `next: DataWindow`, synchronous `dataWindow()`.
- **C, common-caller**: ten async methods, one `MarketView`, engine-side truncation, per-item
  `null` plus notes, JSON wire format, `underlyingImpliedVolatility`. Chosen as the base because
  the three common callers (pricing action, chunked backtest handler, nightly evaluation) each
  become one call with one input object. Changed: truncation keyed on `asOf` instead of
  session-or-close heuristics, `instantiateStructure` folded into `priceOperation`, `Leg`
  declared by the engine over `LegTemplate` from `contracts`, checkpoint keyed on config not view
  fingerprint, `AsOf = date | instant` replaced by `Instant` only (one comparison, one rule),
  caller-provided adjusted candles replaced by nominal candles plus point-in-time factors.
- **Hybrid (this ADR)**: C's shape with B's visibility and capabilities and A's composition.
  Flagged as YAGNI and left out: `inputsDigest`, a pluggable pricing model (ADR-0002 fixes BSM;
  CRR will be an additive input field), candle resampling, a batch indicators call across
  tickers, `Signal` records for non-firing evaluations (they are `EvaluationRecord`s instead).
  Kept despite a YAGNI flag: `LegInput.volatility`, so that `volatilitySource: "given"` has an
  input path (what-if pricing in the builder); it is one optional field and is removable without
  a superseding ADR if the builder never uses it.

## Consequences

`market-data` gains one job, building a `MarketView` from its tables for a set of instruments and
a `DataWindow`, with nominal candles and corporate-action factors rather than a precomputed
adjusted series; every other module calls the engine with that view and reads a `Result`. The
object a server action receives is the object stored and the object sent to the AI, with
provenance attached, which is what ADR-0009 needs. The engine can be replaced by a worker or
another language behind the same `Engine` type, with one constraint: `dataWindow` is synchronous
and stays in-process in any replacement (callers use it before loading data; it must never await
I/O or a message round-trip). Any web-side Zod schema that validates leg input must be asserted
against the engine type at its definition site (`satisfies z.ZodType<LegInput>`) so the two
cannot drift. The cost is uniformity: pricing three legs means assembling a view instead of
passing scalars, and a backtest chunk re-sends its view slice each request; both are bounded and
were accepted knowingly. Multi-expiry structures are excluded from v1 by the `Structure` schema
(ADR-0014 Q43), so payoff is always at one expiry.
