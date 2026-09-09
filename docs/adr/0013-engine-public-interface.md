---
status: accepted
date: 2026-09-09
---

# The engine public interface: ten methods over one market view, frozen

## Context

ADR-0006 made `packages/engine` a pure package whose public interface would be designed twice and
frozen by a later ADR. Three candidate designs were written in `docs/design/engine-interface/`
(A minimal, B flexible, C common-caller) and compared; the owner chose a hybrid on the base of C
on 2026-09-09. This ADR freezes that interface. Everything outside the package (`apps/web`, the AI
layer, tests of other modules) depends on the types below and nothing else; the implementation
behind them is private and arrives in Phase 5 tickets.

## Decision

The engine exposes one `Engine` interface with exactly ten methods, one constant
(`ENGINE_VERSION`) and the types they use. Every input and every artifact is plain JSON: decimals
travel as `DecimalString`, money as integer `Centavos` (BRL, ADR-0001), quantities as integer
`Quantity`, dates as ISO `SessionDate`, times as ISO-8601 UTC `Instant`. No `decimal.js`
instance, class, `Date` or `bigint` crosses the seam. Closed vocabularies (`Timeframe`,
`IndicatorSpec`, `StrikeSelection`, `ExpirySelection`, `SizingRule`, `ExitRule`,
`AdjustmentRule`, `CostModel`, `RiskProfile`, `Structure`, `Condition`, `StrategyDefinition`,
`ThesisClaim`) are Zod schemas in `packages/contracts`; the engine imports their derived types
only (`import type`, enforced by lint), so `contracts` owns the vocabulary and the engine stays
pure. The engine declares every other type.

Shape (from C): named async methods returning `Promise<Result<T>>`, one `MarketView` input type for
every computation, the engine sorts and truncates the view itself, per-item failures are `null`
plus a `Note` rather than a whole-call error, `Provenance` and `notes` on every artifact.
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
  CostModel,
  DecimalString,
  ExitRule,
  ExpirySelection,
  IndicatorSpec,
  Instant,
  Quantity,
  RiskProfile,
  SessionDate,
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

export type EngineError =
  | { code: "invalid_input"; path: string; message: string }
  | { code: "unsupported"; vocabulary: keyof Omit<Capabilities, "engineVersion">; kind: string }
  | { code: "missing_instrument"; ticker: Ticker }
  | { code: "insufficient_data"; needed: DataWindow }
  | {
      code: "no_series_matches";
      underlying: Ticker;
      strikes: StrikeSelection[];
      expiry: ExpirySelection;
    }
  | { code: "unsizeable"; reason: "unbounded_max_loss" | "no_declared_capital" }
  | { code: "checkpoint_mismatch"; expectedDigest: string; receivedDigest: string };

export type NoteCode =
  | "european_pricing"
  | "dividend_yield_defaulted"
  | "candle_form_substituted"
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
  | "no_thesis_claim"
  | "unbounded_max_loss";

export type Note = { code: NoteCode; message: string };

export type MarketViewCollection =
  | "candles"
  | "optionSeries"
  | "optionPrices"
  | "quotes"
  | "macro"
  | "dividendYields"
  | "impliedVolatilityIndex";

export type TruncationReport = {
  collection: MarketViewCollection;
  ticker: Ticker | null;
  dropped: number;
  reason: "after_at" | "unreferenced_instrument";
};

export type PricingModel = "bsm_continuous_yield";

export type Provenance = {
  engineVersion: string;
  pricingModel: PricingModel;
  truncated: TruncationReport[];
};

export type TradingSession = { date: SessionDate; open: Instant; close: Instant };

export type CandleForm = "adjusted" | "nominal";

export type Candle = {
  ticker: Ticker;
  timeframe: Timeframe;
  form: CandleForm;
  session: SessionDate;
  asOf: Instant;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  volume: number;
};

export type OptionRight = "call" | "put";
export type ExerciseStyle = "american" | "european";

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
  volume: number;
};

export type Quote = {
  ticker: Ticker;
  asOf: Instant;
  last: DecimalString | null;
  bid: DecimalString | null;
  ask: DecimalString | null;
};

export type MacroSeriesKind = "cdi" | "selic" | "ipca";

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
  optionSeries: OptionSeries[];
  optionPrices: OptionDayPrice[];
  quotes: Quote[];
  macro: MacroPoint[];
  dividendYields: DividendYieldPoint[];
  impliedVolatilityIndex: ImpliedVolatilityIndexPoint[];
};

export type DataWindow = {
  from: Instant;
  to: Instant;
  instruments: Ticker[];
  timeframes: Timeframe[];
  collections: MarketViewCollection[];
};

export type StrategyVersion = { id: string; definition: StrategyDefinition; structure: Structure };

export type LegRole = "stock" | "call" | "put";
export type Side = "buy" | "sell";

export type Leg = { role: LegRole; side: Side; ticker: Ticker; quantity: Quantity };

export type LegInput = Leg & { price?: DecimalString };

export type OperationLeg = Leg & { entryPrice: DecimalString };

export type OperationStatus = "open" | "adjusted" | "closed" | "expired";

export type Operation = {
  id: string;
  underlying: Ticker;
  legs: OperationLeg[];
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

export type Position = { ticker: Ticker; quantity: Quantity; averageCost: DecimalString };

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
  greeks: Greeks | null;
  timeToExpiryYears: DecimalString | null;
  note?: Note;
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

export type EvaluationOutcome =
  "signal" | "conditions_not_met" | "no_series_match" | "insufficient_data" | "unsizeable";

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

export type FillSource = "next_session_open" | "next_session_average" | "fair_value";

export type SimulatedFill = Fill & { operationId: string; source: FillSource };

export type MissedEntryReason = "no_trades" | "limit_breach" | "no_series_match" | "unsizeable";

export type MissedEntry = {
  ticker: Ticker;
  signalAt: Instant;
  sessionsTried: number;
  reason: MissedEntryReason;
};

export type CloseReason =
  | { kind: "exit_rule"; rule: ExitRule }
  | { kind: "rolled"; toOperationId: string }
  | { kind: "expiry" }
  | { kind: "period_end" };

export type SimulatedOperation = Operation & {
  status: OperationStatus;
  closedAt: SessionDate | null;
  closeReason: CloseReason | null;
  pnl: Centavos;
  maxLoss: Centavos | "unbounded";
};

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
  winRate: DecimalString;
  profitFactor: DecimalString | null;
  exposure: DecimalString;
  fees: Centavos;
  taxes: Centavos;
  slippage: Centavos;
};

export type WalkForwardWindow = { from: SessionDate; to: SessionDate; metrics: BacktestMetrics };

export type MonthlyTax = { month: string; netGain: Centavos; tax: Centavos };

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

export type PositionValuation = {
  position: Position;
  price: DecimalString | null;
  priceSource: PriceSource | null;
  stale: { session: SessionDate } | null;
  value: Centavos | null;
  unrealizedPnl: Centavos | null;
  note?: Note;
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

export type SettlementOutcome = "exercised" | "assigned" | "expired_worthless" | "kept";

export type LegSettlement = {
  leg: OperationLeg;
  outcome: SettlementOutcome;
  intrinsicValue: DecimalString | null;
  proposedFills: Fill[];
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

export type ScoreSubject = DecisionKind | "analysis";

export type DecisionOrigin = { kind: "signal"; strategy: StrategyVersion } | { kind: "manual" };

export type Score = {
  pnl: Centavos | null;
  maxLoss: Centavos | "unbounded";
  normalizedPnl: DecimalString | null;
  thesis: { held: boolean | null; brier: DecimalString | null };
  counterfactualPnl: Centavos | null;
  notes: Note[];
  provenance: Provenance;
};

export type ImpliedVolatilityIndexMethod = "atm_30d_interpolated";

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
  openOperations?: number;
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

export type ProposeSettlementInput = {
  view: MarketView;
  operation: Operation;
  expiry: SessionDate;
};

export type ScoreInput = {
  view: MarketView;
  subject: ScoreSubject;
  decidedAt: Instant;
  horizon: SessionDate;
  confidence: DecimalString;
  claim: ThesisClaim | null;
  operation: Operation;
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

- **Visibility.** A row is visible to a computation at `at` iff `row.asOf <= at`. `asOf` is the
  candle close for candles, the session close for daily option prices, the publication time for
  macro points, the quote timestamp for quotes, the listing time for option series, the
  publication time for dividend yields and implied-volatility index points. The calendar is the
  only collection exempt (a published schedule). Rows later than `at` are dropped before any
  computation and counted in `provenance.truncated` with reason `after_at`; rows for instruments
  the call does not reference are counted with reason `unreferenced_instrument`.
- **Inside a backtest** the evaluator sees the view truncated at each session close in turn and a
  signal at session D is filled with session D+1 data only (ADR-0004); intraday runs follow
  ADR-0011. Missed entries retry per ADR-0014.
- **Candle forms.** Indicators and conditions read `adjusted` candles; strikes, option prices,
  fills and settlement read `nominal`. When the needed form is absent for a ticker and timeframe
  the other form is used with note `candle_form_substituted`.
- **Risk-free rate** is the latest visible `cdi` macro point; **dividend yield** is the latest
  visible point for the underlying, defaulting to zero with note `dividend_yield_defaulted`.
  Time to expiry counts trading sessions over 252.
- **`priceOperation` with a `LegSelection`** resolves strikes (aligned with the structure's option
  legs in order; `strikeRank` must be respected or `invalid_input`), expiry (business-day window
  over the calendar) and quantity (a `Quantity` is structure units, each leg's quantity is
  `ratio * units`; a `SizingRule` needs `riskProfile.declaredCapital`, else `unsizeable`). No
  series matching the selection is `no_series_matches`. Without a `riskProfile` pricing proceeds
  with note `no_risk_profile` and empty `limitBreaches` (ADR-0014 Q44).
- **`evaluateStrategy`** evaluates at every candle close of the strategy's timeframe in
  `(since, at]`, or once at the latest close `<= at` when `since` is omitted. Every evaluation
  produces an `EvaluationRecord`; only `entry`, `exit` and `adjust` outcomes also produce a
  `Signal`. "No option series matches" is a record, never a signal (ADR-0014 Q45). The engine
  does not mark late signals: it has no clock; the caller compares `signal.at` with its own time
  (ADR-0010).
- **`runBacktest`** advances from `resume.cursor` (or `period.from`) while data, `maxSessions` and
  the period allow, then returns `paused` with a checkpoint and the `DataWindow` the next call
  needs, or `complete`. Sizing fractions and risk-profile limits apply to the run's current
  equity; `riskProfile.declaredCapital` is ignored inside a run. `config.sizing` overrides the
  strategy's sizing rule when present. `walkForward` reports out-of-sample metrics per rolling
  window of the same strategy version (ADR-0014 Q37). `seed` is the only entropy; nothing in v1
  consumes it, and it is part of the config so that any future consumer stays reproducible.
- **`markToMarket`**: `totals.equity = cash + sum of position values`; operations are an
  attribution view over the same fills and never add to totals. A series with no trade that
  session is marked at its last trade with `stale` set and `fairValue` alongside (ADR-0014 Q42).
- **`proposeSettlement`** exercises or assigns any option leg in the money at the expiry session
  close by any amount (ADR-0014 Q41); stock legs are `kept`.
- **`score`** follows ADR-0005 as amended by ADR-0014: `pnl` is the operation's P&L between
  `decidedAt` and the horizon session close from `realizedFills` plus marks; `normalizedPnl` is
  `pnl / maxLoss`, `null` when max loss is unbounded (note `unbounded_max_loss`); `thesis.held`
  comes from `claim`, `null` without one (note `no_thesis_claim`); `counterfactualPnl` is set for
  `do_not_enter` only, using `origin` to choose the exit rule.
- **`impliedVolatilityIndex`** returns the at-the-money 30-calendar-day implied volatility of the
  underlying interpolated between the two nearest expiries (`atm_30d_interpolated`); `null` with
  a note when the chain cannot support it. Ingestion persists it so `iv_rank` reads it back from
  `MarketView.impliedVolatilityIndex`.
- **`dataWindow`** is synchronous and needs no view: from the strategy it derives lookback per
  timeframe, whether a chain, macro rates or the implied-volatility index are needed, and uses the
  calendar to turn candle counts into `from`. `to` is `at`.

### Error union

`EngineError` is the complete list of whole-call failures: `invalid_input` (semantic, after Zod),
`unsupported` (a `kind` the contracts allow but the engine does not implement; see
`capabilities()`), `missing_instrument`, `insufficient_data` (naming the `DataWindow` that would
suffice), `no_series_matches`, `unsizeable`, `checkpoint_mismatch`. Anything else that can go
wrong is a `null` field with a `Note` on the item or a `Note` on the artifact. A thrown exception
from the engine is a bug.

### Ordering constraints

Arrays in `MarketView` may arrive in any order; the engine sorts (I3). Duplicate keys (same
ticker, timeframe, form and `asOf` for candles; same ticker and session for option prices; same
series, date for macro points) are `invalid_input`. `since < at`. `resume.configDigest` must
equal the digest of `config` and `resume.engineVersion` must equal `ENGINE_VERSION`, else
`checkpoint_mismatch`; the caller restarts the run from `config` (runs are immutable anyway).
`calendar` must cover every session a call touches, else `insufficient_data`.

### Invariants

Each invariant is a property test in `packages/engine/src/invariants/`, written with `fast-check`
and landing with the first implementation ticket that makes it testable.

- **I1 Future-blind** (`i1-future-blind.property.test.ts`): for every method that takes `at`,
  appending rows with `asOf > at` to the view never changes the artifact, and the dropped rows
  appear in `provenance.truncated`.
- **I2 Chunk-invariance** (`i2-chunk-invariance.property.test.ts`): any sequence of `runBacktest`
  calls with any `maxSessions` values and their checkpoints yields a `BacktestRun` deep-equal to
  one uninterrupted call.
- **I3 Order-invariance** (`i3-order-invariance.property.test.ts`): any permutation of any
  `MarketView` array yields a deep-equal artifact.
- **I4 Determinism** (`i4-determinism.property.test.ts`): identical inputs yield deep-equal
  artifacts; the engine reads no clock, environment or `Math.random`; `seed` is the only entropy.
- **I5 Numeric discipline** (`i5-numeric-discipline.property.test.ts`): every `Centavos` and
  `Quantity` in an artifact is an integer; every `DecimalString` is canonical at ADR-0001 scales
  (prices 2, greeks, volatilities and ratios 6); `JSON.parse(JSON.stringify(x))` is the identity
  on every artifact.
- **I6 Provenance** (`i6-provenance.test.ts`): every artifact carries `provenance.engineVersion`
  equal to `ENGINE_VERSION`, the pricing model, the truncation report, and a `Note` for each
  approximation applied (`european_pricing` per ADR-0002, `intraday_option_fill_at_fair_value`
  and `short_window_not_annualized` per ADR-0011).

A seventh test, `capabilities.conformance.test.ts`, asserts that every `kind` reported by
`capabilities()` is a member of the matching `contracts` enum and that every member of those
enums is either reported or explicitly listed as unsupported.

### Change policy

Additive changes are allowed without a new ADR: new optional input fields, new fields on
artifacts, new `NoteCode` and `EvaluationOutcome` members, new `kind`s in a contracts vocabulary
(schema, engine code, capabilities and tests together). Renames, removals, signature changes,
new or removed methods, changes to the visibility rule or to the meaning of an existing field
require a superseding ADR. `ENGINE_VERSION` bumps its minor on additive change and its major on a
superseding ADR; checkpoints are valid only for the version that produced them.

The `money` module exports (`Money`, `add`, `subtract`, `formatBRL`, `NonIntegerAmountError`) are
legacy and outside this interface: they exist only because the `apps/web` placeholder page still
renders `formatBRL`. The ticket that gives `apps/web` its own pt-BR currency formatter removes
them from `packages/engine`; nothing new may import them.

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
  `null` plus `Note`, JSON wire format, `underlyingImpliedVolatility`. Chosen as the base because
  the three common callers (pricing action, chunked backtest handler, nightly evaluation) each
  become one call with one input object. Changed: truncation keyed on `asOf` instead of
  session-or-close heuristics, `instantiateStructure` folded into `priceOperation`, `Leg`
  declared by the engine rather than `contracts`, checkpoint keyed on config not view fingerprint,
  `AsOf = date | instant` replaced by `Instant` only (one comparison, one rule).
- **Hybrid (this ADR)**: C's shape with B's visibility and capabilities and A's composition.
  Flagged as YAGNI and left out: `inputsDigest`, a pluggable pricing model (ADR-0002 fixes BSM;
  CRR will be an additive input field), candle resampling, a batch indicators call across
  tickers, `Signal` records for non-firing evaluations (they are `EvaluationRecord`s instead).

## Consequences

`market-data` gains one job, building a `MarketView` from its tables for a set of instruments and
a `DataWindow`; every other module calls the engine with that view and reads a `Result`. The
object a server action receives is the object stored and the object sent to the AI, with
provenance attached, which is what ADR-0009 needs. The engine can be replaced by a worker or
another language behind the same `Engine` type. The cost is uniformity: pricing three legs means
assembling a view instead of passing scalars, and a backtest chunk re-sends its view slice each
request; both are bounded and were accepted knowingly. Multi-expiry structures are excluded from
v1 by the `Structure` schema (ADR-0014 Q43), so payoff is always at one expiry.
