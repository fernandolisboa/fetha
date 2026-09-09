# Engine public interface, variant B: flexible

Design constraint: extension (indicators, pricing models, fill models, metrics, timeframes, thesis
predicates) without changing callers; small capabilities that compose; frozen-able. The bet: freeze
the **shapes and signatures**, keep every **vocabulary** open as data, and make every intermediate
result a serializable artifact that can be fed to the next capability.

## 1. Interface

### 1.1 Conventions

- `packages/engine` exports one `Engine` interface, `createEngine(): Engine`, the scalar codec and
  the types below. Nothing else is public. Callers depend on the `Engine` type only, so a worker or
  WASM implementation ships as another `createEngine` with the same interface (hence `Promise`
  returns even though the reference implementation is synchronous).
- Every request and artifact is plain JSON: `Decimal` values cross the seam as `DecimalString`,
  money as `Money` (integer centavos), instants as ISO 8601 UTC strings. No class instances, no
  `Date`, no `bigint`.
- Every method returns `Result<T>`; the engine never throws for domain reasons. Errors are values.
- Every artifact carries `provenance`: `engineVersion`, `inputsDigest` (stable hash of the
  canonicalized request), the models and approximations used. Identical digest implies identical
  artifact; callers may use it as a cache key and the AI layer cites it.
- Vocabularies (kinds of indicator, pricing model, fill model, metric, strike/expiry selection,
  sizing rule, exit rule, thesis predicate, timeframe) are Zod enums owned by `packages/contracts`.
  The engine imports their derived types and reports what it implements in `capabilities()`; a
  test in the engine asserts the two agree. Adding a kind is additive: schema + engine code + test.

### 1.2 Scalars and codec

```ts
type DecimalString = string & { readonly __brand: "DecimalString" }; // /^-?\d+(\.\d+)?$/, no exponent, no thousands separator
type Money = { amountCentavos: number; currency: "BRL" }; // integer; kept from the current module
type Quantity = number; // integer shares or option units
type Instant = string; // "2026-09-08T20:00:00Z"
type SessionDate = string; // "2026-09-08", America/Sao_Paulo trading session
type Ticker = string; // B3 ticker, identifies an instrument
type Seed = number; // uint32; the only source of randomness

const codec: {
  decimal(value: Decimal | string | number): DecimalString; // canonicalizes; throws on NaN/Infinity (programming error)
  toDecimal(value: DecimalString): Decimal;
  money(centavos: number): Money; // asserts integer
};
type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError };
```

### 1.3 Market dataset and the look-ahead guard

Callers never build a data view. They hand the engine a `MarketDataset` and an evaluation time;
the engine derives the view internally with one rule: **a row is visible at `t` iff
`row.asOf <= t`**. Every row type carries `asOf` (a candle's `closeTime`, a quote's timestamp, a
macro point's publication, a series listing date). Passing future rows is harmless: they are
invisible until their `asOf`. The trading calendar is the only exemption (a published schedule).

```ts
type Candle = {
  closeTime: Instant;
  session: SessionDate;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  volume: number;
};
type CandleSeries = {
  instrument: Ticker;
  timeframe: Timeframe;
  form: "adjusted" | "nominal";
  candles: readonly Candle[];
}; // ascending closeTime, unique
type OptionSeriesRow = {
  ticker: Ticker;
  underlying: Ticker;
  right: "call" | "put";
  strike: DecimalString;
  expiry: SessionDate;
  style: "american" | "european";
  asOf: Instant;
};
type OptionQuote = {
  series: Ticker;
  asOf: Instant;
  session: SessionDate;
  close?: DecimalString;
  average?: DecimalString;
  bid?: DecimalString;
  ask?: DecimalString;
  trades: number;
  volume: number;
};
type MacroPoint = {
  series: "cdi" | "selic" | "ipca";
  asOf: Instant;
  date: SessionDate;
  annualRate: DecimalString;
};
type DividendYieldPoint = { underlying: Ticker; asOf: Instant; annualYield: DecimalString };
type TradingSession = { date: SessionDate; open: Instant; close: Instant };
type MarketDataset = {
  candles: CandleSeries[];
  optionSeries: OptionSeriesRow[];
  optionQuotes: OptionQuote[];
  macro: MacroPoint[];
  dividendYields: DividendYieldPoint[];
  calendar: TradingSession[];
};
type DataWindow = { from: Instant; to: Instant; instruments: Ticker[] }; // what the engine needs loaded next
```

### 1.4 Vocabularies imported from `@fetha/contracts` (type-only)

```ts
import type {
  Timeframe,
  IndicatorSpec,
  PricingModel,
  FillModel,
  MetricKind,
  StrikeSelection,
  ExpirySelection,
  SizingRule,
  ExitRule,
  CostModel,
  RiskProfile,
  Structure,
  StrategyVersion,
  ThesisPredicate,
} from "@fetha/contracts";
// v1 members, all discriminated on `kind`:
// Timeframe        "15m" | "30m" | "60m" | "D1"
// IndicatorSpec    { kind: "sma" | "ema" | "rsi" | "atr", length } | { kind: "iv_rank", lookbackSessions }
// PricingModel     { kind: "bsm" }                          (later: { kind: "crr", steps })
// FillModel        { kind: "next-session-open" } | { kind: "next-session-average", slippage: DecimalString }
//                  | { kind: "model-fair-value", slippage: DecimalString }        (ADR-0004, ADR-0011)
// MetricKind       "total_return" | "cagr" | "max_drawdown" | "sharpe" | "sortino" | "win_rate" | "profit_factor" | "exposure"
// StrikeSelection  { kind: "delta", target } | { kind: "moneyness", pct } | { kind: "nearest", price }
// ExpirySelection  { kind: "business-days", min, max }
// SizingRule       { kind: "fixed-fractional", fraction } | { kind: "fixed-risk", fraction }
// ThesisPredicate  { kind: "close-above" | "close-below", instrument, level } | { kind: "operation-pnl-positive" }
```

Every fill model in the vocabulary fills strictly after the signal candle; there is no kind that
can express a same-candle fill, so hygiene survives extension.

### 1.5 The `Engine` interface

```ts
interface Engine {
  capabilities(): Capabilities;
  dataWindow(req: { strategy: StrategyVersion; instruments: Ticker[]; at: Instant }): DataWindow; // warm-up the strategy needs before `at`; sync, no dataset
  indicators(req: IndicatorsRequest): Promise<Result<IndicatorArtifact>>;
  price(req: PricingRequest): Promise<Result<PricingArtifact>>;
  instantiate(req: InstantiateRequest): Promise<Result<InstantiatedStructure>>;
  analyzeStructure(req: AnalyzeRequest): Promise<Result<StructureAnalysis>>;
  evaluate(req: EvaluationRequest): Promise<Result<EvaluationArtifact>>;
  backtest(req: BacktestRequest): Promise<Result<BacktestProgress>>;
  walkForward(req: WalkForwardRequest): Promise<Result<WalkForwardArtifact>>;
  markToMarket(req: MarkToMarketRequest): Promise<Result<PortfolioValuation>>;
  proposeSettlement(req: SettlementRequest): Promise<Result<SettlementProposal>>;
  score(req: ScoreRequest): Promise<Result<ScoreArtifact>>;
}

type Capabilities = {
  engineVersion: string;
  timeframes: Timeframe[];
  indicators: IndicatorSpec["kind"][];
  pricingModels: PricingModel["kind"][];
  fillModels: FillModel["kind"][];
  metrics: MetricKind[];
  strikeSelections: StrikeSelection["kind"][];
  expirySelections: ExpirySelection["kind"][];
  sizingRules: SizingRule["kind"][];
  exitRules: ExitRule["kind"][];
  thesisPredicates: ThesisPredicate["kind"][];
};

type Provenance = {
  engineVersion: string;
  inputsDigest: string;
  pricingModel?: PricingModel;
  approximations: string[];
  warnings: Warning[];
};
type Warning = {
  code:
    | "TOO_SHORT_TO_ANNUALIZE"
    | "PRICED_AS_EUROPEAN"
    | "MISSED_FILL"
    | "LIMIT_BREACH_WARNED"
    | "LATE_SIGNAL";
  detail: string;
};

type IndicatorsRequest = {
  dataset: MarketDataset;
  instrument: Ticker;
  timeframe: Timeframe;
  form?: "adjusted" | "nominal";
  specs: IndicatorSpec[];
  at: Instant;
};
type IndicatorArtifact = {
  points: { closeTime: Instant; values: Record<string, DecimalString | null> }[];
  keys: { key: string; spec: IndicatorSpec }[];
  provenance: Provenance;
};

type PricingRequest = {
  model?: PricingModel;
  option: {
    right: "call" | "put";
    strike: DecimalString;
    expiry: SessionDate;
    style: "american" | "european";
  };
  spot: DecimalString;
  at: Instant;
  riskFreeRate: DecimalString;
  dividendYield: DecimalString;
  calendar: TradingSession[];
  volatility:
    { kind: "given"; sigma: DecimalString } | { kind: "implied"; marketPrice: DecimalString };
};
type Greeks = {
  delta: DecimalString;
  gamma: DecimalString;
  theta: DecimalString;
  vega: DecimalString;
  rho: DecimalString;
};
type PricingArtifact = {
  fairValue: DecimalString;
  impliedVolatility: DecimalString | null;
  greeks: Greeks;
  timeToExpiry: { sessions: number; years: DecimalString };
  provenance: Provenance;
};

type Leg = {
  role: "stock" | "call" | "put";
  side: "buy" | "sell";
  ratio: number;
  instrument?: Ticker;
  strike?: DecimalString;
  expiry?: SessionDate;
};
type InstantiateRequest = {
  structure: Structure;
  underlying: Ticker;
  strike: StrikeSelection;
  expiry: ExpirySelection;
  sizing: { rule: SizingRule; declaredCapital: Money };
  dataset: MarketDataset;
  at: Instant;
  model?: PricingModel;
};
type InstantiatedStructure = {
  legs: Required<Leg>[];
  quantity: Quantity;
  referencePrices: Record<Ticker, DecimalString>;
  provenance: Provenance;
};

type AnalyzeRequest = {
  legs: Required<Leg>[];
  quantity: Quantity;
  prices: Record<Ticker, DecimalString>;
  dataset: MarketDataset;
  at: Instant;
  model?: PricingModel;
  riskProfile?: RiskProfile;
  payoffGrid?: { from: DecimalString; to: DecimalString; steps: number };
};
type StructureAnalysis = {
  payoff: { underlying: DecimalString; pnl: Money }[];
  breakEvens: DecimalString[];
  maxLoss: Money | "unbounded";
  maxGain: Money | "unbounded";
  netPremium: Money;
  perLeg: { leg: Required<Leg>; pricing: PricingArtifact }[];
  greeks: Greeks;
  limitBreaches: LimitBreach[];
  provenance: Provenance;
};
type LimitBreach = { limit: keyof RiskProfile["limits"]; value: DecimalString; max: DecimalString };

type EvaluationRequest = {
  strategy: StrategyVersion;
  instruments: Ticker[];
  dataset: MarketDataset;
  at: Instant | { from: Instant; to: Instant };
  declaredCapital: Money;
  riskProfile?: RiskProfile;
  model?: PricingModel;
};
type Signal = {
  strategyVersionId: string;
  instrument: Ticker;
  evaluationTime: Instant;
  kind: "entry" | "exit" | "adjust";
  late: boolean;
  fired: { key: string; spec: IndicatorSpec; value: DecimalString }[];
  proposal: InstantiatedStructure | null;
};
type EvaluationArtifact = {
  signals: Signal[];
  evaluations: {
    instrument: Ticker;
    evaluationTime: Instant;
    outcome: "signal" | "none" | "no-series" | "insufficient-data";
    reason?: string;
  }[];
  provenance: Provenance;
};

type BacktestConfig = {
  strategy: StrategyVersion;
  universe: Ticker[];
  period: { from: SessionDate; to: SessionDate };
  initialCapital: Money;
  costs: CostModel;
  sizing: SizingRule;
  fills?: { stock: FillModel; option: FillModel };
  limits: "enforce" | "warn";
  riskProfile: RiskProfile;
  metrics?: MetricKind[];
  model?: PricingModel;
  seed: Seed;
};
type BacktestRequest = {
  config: BacktestConfig;
  dataset: MarketDataset;
  resume?: BacktestCheckpoint;
  budget?: { sessions: number };
};
type BacktestCheckpoint = {
  schema: 1;
  configDigest: string;
  cursor: Instant;
  state: unknown;
  partial: { equity: EquityPoint[]; fills: SimulatedFill[]; operations: SimulatedOperation[] };
};
type BacktestProgress =
  | { status: "paused"; checkpoint: BacktestCheckpoint; next: DataWindow }
  | { status: "done"; run: BacktestRun };
type EquityPoint = { session: SessionDate; equity: Money; cash: Money; drawdown: DecimalString };
type SimulatedFill = {
  operationId: string;
  instrument: Ticker;
  side: "buy" | "sell";
  quantity: Quantity;
  price: DecimalString;
  session: SessionDate;
  fillModel: FillModel;
  costs: Money;
};
type SimulatedOperation = {
  id: string;
  legs: Required<Leg>[];
  quantity: Quantity;
  entrySignal: Instant;
  opened: SessionDate | null;
  closed: SessionDate | null;
  status: "open" | "adjusted" | "closed" | "expired" | "missed";
  pnl: Money | null;
  rolledFrom?: string;
};
type BacktestRun = {
  config: BacktestConfig;
  equity: EquityPoint[];
  fills: SimulatedFill[];
  operations: SimulatedOperation[];
  metrics: Record<MetricKind, DecimalString | null>;
  taxes: { month: string; netGain: Money; tax: Money }[];
  provenance: Provenance;
};

type WalkForwardCheckpoint = {
  schema: 1;
  configDigest: string;
  fold: number;
  inner: BacktestCheckpoint | null;
  folds: WalkForwardArtifact["folds"];
};
type WalkForwardRequest = {
  candidates: StrategyVersion[];
  base: Omit<BacktestConfig, "strategy">;
  dataset: MarketDataset;
  objective: MetricKind;
  windows: { inSampleSessions: number; outOfSampleSessions: number };
  resume?: WalkForwardCheckpoint;
  budget?: { sessions: number };
};
type WalkForwardArtifact =
  | {
      folds: {
        inSample: { from: SessionDate; to: SessionDate };
        outOfSample: { from: SessionDate; to: SessionDate };
        chosen: string;
        outOfSampleRun: BacktestRun;
      }[];
      stitched: { equity: EquityPoint[]; metrics: Record<MetricKind, DecimalString | null> };
      provenance: Provenance;
    }
  | { status: "paused"; checkpoint: WalkForwardCheckpoint; next: DataWindow };

type MarkToMarketRequest = {
  positions: { instrument: Ticker; quantity: Quantity; averageCost: DecimalString }[];
  operations: { id: string; legs: Required<Leg>[]; quantity: Quantity }[];
  cash: Money;
  dataset: MarketDataset;
  at: Instant;
  model?: PricingModel;
};
type PortfolioValuation = {
  total: Money;
  positions: {
    instrument: Ticker;
    price: DecimalString;
    value: Money;
    unrealized: Money;
    stale: boolean;
  }[];
  operations: { id: string; value: Money; greeks: Greeks; analysis: StructureAnalysis }[];
  greeks: Greeks;
  provenance: Provenance;
};
type SettlementRequest = {
  operation: { id: string; legs: Required<Leg>[]; quantity: Quantity };
  expiry: SessionDate;
  dataset: MarketDataset;
};
type SettlementProposal = {
  legs: {
    leg: Required<Leg>;
    outcome: "exercised" | "assigned" | "expired-worthless";
    settlementPrice: DecimalString;
    cashFlow: Money;
    stockDelta: Quantity;
  }[];
  provenance: Provenance;
};

type ScoreRequest = {
  subject:
    | { kind: "decision"; decision: DecisionSnapshot }
    | { kind: "analysis"; analysis: AnalysisSnapshot };
  dataset: MarketDataset;
  horizon: Instant;
  fills?: { stock: FillModel; option: FillModel };
  costs: CostModel;
  model?: PricingModel;
};
type DecisionSnapshot = {
  kind: "enter" | "do-not-enter" | "hold" | "adjust" | "exit";
  decidedAt: Instant;
  operation: {
    legs: Required<Leg>[];
    quantity: Quantity;
    entryPrices?: Record<Ticker, DecimalString>;
  };
  maxLoss: Money | "unbounded";
  thesis: { predicate: ThesisPredicate | null; confidence: DecimalString };
};
type AnalysisSnapshot = {
  analyzedAt: Instant;
  operation: DecisionSnapshot["operation"];
  maxLoss: Money | "unbounded";
  thesis: DecisionSnapshot["thesis"];
};
type ScoreArtifact = {
  realizedPnl: Money | null;
  normalizedPnl: DecimalString | null;
  thesis: { held: boolean | null; brier: DecimalString | null };
  counterfactualPnl: Money | null;
  provenance: Provenance;
};
```

### 1.6 Errors

```ts
type EngineError =
  | { code: "INVALID_INPUT"; path: string; message: string }
  | { code: "UNSUPPORTED"; vocabulary: keyof Capabilities; kind: string }
  | { code: "DATA_UNORDERED"; path: string }
  | { code: "INSUFFICIENT_DATA"; needed: DataWindow }
  | { code: "IV_NOT_CONVERGED"; marketPrice: DecimalString; bounds: [DecimalString, DecimalString] }
  | { code: "NO_SERIES"; strike: StrikeSelection; expiry: ExpirySelection; reason: string }
  | { code: "LIMIT_BREACH"; breaches: LimitBreach[] }
  | { code: "CHECKPOINT_MISMATCH"; expectedDigest: string; receivedDigest: string }
  | { code: "UNBOUNDED_MAX_LOSS"; context: "fixed-risk-sizing" | "normalized-pnl" };
```

Recoverable conditions that still yield an artifact are `Warning`s in `provenance`, never errors:
a missed fill, a short window that refuses to annualize, a limit breach under `warn`, a late signal.
`NO_SERIES` is an error from `instantiate` but an `evaluations[].outcome` inside `evaluate`.

### 1.7 Invariants and ordering constraints

- **Determinism**: same request (by digest) yields a deep-equal artifact, across chunk boundaries,
  budgets and `Engine` implementations of the same `engineVersion`. Property-tested.
- **Chunk transparency**: `backtest` with any sequence of `budget`s and `resume`s equals one
  unbudgeted call. The checkpoint is opaque to callers but JSON; its `configDigest` must match the
  request config or `CHECKPOINT_MISMATCH`.
- **No look-ahead**: rows with `asOf > t` are invisible at `t`. Fills use only rows visible at
  the fill candle; a signal at candle `k` fills at candle `k+1` or later. Property test: appending
  future rows to a dataset never changes any artifact computed at an earlier `at`.
- **Ordering**: `candles` ascending by `closeTime`, unique; `calendar` ascending; other arrays
  may be unordered (the engine indexes them). Violations are `DATA_UNORDERED`, not silent sorts.
- **Numeric**: money in artifacts is always integer centavos; `DecimalString` is canonical so
  string equality is numeric equality at the emitted scale (prices 2, greeks/IV/percentages 6).
- **Purity**: no clock, no environment, no `Math.random`; `seed` is the only entropy and is
  echoed in `BacktestConfig`.

### 1.8 Performance characteristics

Indicators are single-pass streaming, O(n) per spec. Pricing is O(1) analytic; implied volatility
is Newton with bisection fallback, bounded at 100 iterations and tolerance 1e-8, or
`IV_NOT_CONVERGED`. `evaluate` is O(candles × instruments × conditions). `backtest` is
O(sessions × universe × conditions) plus O(open operations × legs) pricing per session; memory is
O(dataset) plus the checkpoint. The `budget` is measured in sessions, not wall time, so chunk
boundaries are reproducible; callers pick a budget that fits `maxDuration` and call again.

## 2. Usage examples

### 2.1 Pricing a structure in a server action

```ts
const engine = createEngine();
const dataset = await marketData.datasetFor({ instruments: [underlying, ...legTickers], upTo: at });
const analysis = await engine.analyzeStructure({
  legs,
  quantity,
  prices,
  dataset,
  at,
  riskProfile,
});
if (!analysis.ok) return { error: analysis.error }; // typed union, mapped to pt-BR copy
return analysis.value; // payoff, break-evens, greeks, breaches; JSON straight to UI and AI
```

### 2.2 Chunked backtest in a route handler (`maxDuration` raised)

```ts
let resume = await runs.loadCheckpoint(runId); // undefined on first call
let window = resume
  ? await runs.loadNextWindow(runId) // persisted alongside the checkpoint
  : engine.dataWindow({
      strategy: config.strategy,
      instruments: config.universe,
      at: sessionClose(config.period.from),
    });
for (;;) {
  const dataset = await marketData.datasetFor(window);
  const step = await engine.backtest({ config, dataset, resume, budget: { sessions: 120 } });
  if (!step.ok) return fail(runId, step.error);
  if (step.value.status === "done") return runs.complete(runId, step.value.run);
  await runs.saveCheckpoint(runId, step.value.checkpoint);
  if (nearTimeout()) return runs.scheduleContinuation(runId);
  ({ checkpoint: resume, next: window } = step.value);
}
```

### 2.3 Nightly evaluation of all active daily strategies

```ts
for (const { user, versions, watchlist } of await strategies.activeDaily()) {
  const dataset = await marketData.datasetFor({ instruments: watchlist, upTo: sessionClose });
  for (const strategy of versions) {
    const out = await engine.evaluate({
      strategy,
      instruments: watchlist,
      dataset,
      at: sessionClose,
      declaredCapital,
      riskProfile,
    });
    if (out.ok) await signals.deposit(user, out.value.signals);
  }
}
```

### 2.4 Intraday catch-up on reopening

```ts
const out = await engine.evaluate({
  strategy,
  instruments: [ticker],
  dataset,
  at: { from: lastEvaluated, to: latestClosedCandle },
  declaredCapital,
  riskProfile,
});
// every signal except those at `latestClosedCandle` comes back with late: true
```

### 2.5 Scoring at horizon

```ts
const out = await engine.score({
  subject: { kind: "decision", decision },
  dataset,
  horizon,
  costs,
  fills: defaultFills("D1"),
});
// do-not-enter: counterfactualPnl uses the same FillModel vocabulary as backtests (ADR-0005)
```

## 3. What the implementation hides behind the seam

- The data view: indexing of the dataset by instrument, timeframe and `asOf`; truncation; the
  choice between adjusted (indicators) and nominal (strikes, option prices) forms.
- Indicator kernels and their warm-up lengths; the expression-tree interpreter for ADR-0008
  condition trees; the `key` naming of indicator columns.
- Pricing kernels per `PricingModel`, root finding for implied volatility, the day-count
  convention (trading sessions / 252, CDI as annualized business-day rate) and the
  European-for-all approximation (ADR-0002) surfaced as `PRICED_AS_EUROPEAN`.
- Fill kernels per `FillModel`, cost model arithmetic (B3 fees, brokerage, monthly income tax
  with the stock-only exemption), sizing kernels, limit checks, the event loop of a run, the
  checkpoint layout (`state` is opaque), metrics kernels and the annualization guard (ADR-0011).
- Walk-forward fold scheduling and candidate selection; any seeded randomness.
- Settlement rules per exercise style; Brier and normalization arithmetic for scores.
- The canonical JSON serializer and the digest function.

## 4. Dependency strategy

Injected: nothing executable. The only tunable inputs are data: a `Seed`, a `PricingModel`,
`FillModel`s, `MetricKind`s, `IndicatorSpec`s, all closed unions from `packages/contracts`. Time
is an input (`at`, `horizon`, `period`). Data is an input (`MarketDataset`); the engine never
fetches. The engine depends on `decimal.js` (runtime) and `@fetha/contracts` (types only). The
`Engine` interface is the seam: `apps/web` receives an `Engine` and can swap `createEngine()` for a
worker-backed adapter with no caller change. Extension is by adding a `kind` to a contracts enum
and a kernel behind the seam; `capabilities()` and its conformance test keep the two in step, and
the UI can render forms from `capabilities()` rather than hard-coding lists.

## 5. Trade-offs

- **High leverage**: the `asOf` rule makes look-ahead a data property instead of a discipline, and
  it unifies daily, intraday and live chain data under one truncation. The `kind`-discriminated
  vocabularies plus `capabilities()` let the UI, contracts and engine grow together without
  signature churn. `budget` in sessions plus chunk transparency gives resumable runs with a
  property test instead of an infrastructure decision. `Provenance.inputsDigest` gives caching,
  reproducibility checks and AI citations for free.
- **Thin leverage**: `Promise` returns exist only for a hypothetical worker; until it exists they
  are ceremony in tests (`asyncProperty`) and in server actions. `WalkForward` over candidate
  versions avoids adding parameters to the DSL, but the owner must author variants by hand.
- **Awkward**: `MarketDataset` is a wide bag; small calls (pricing one option) carry a `calendar`
  and possibly empty arrays. `Required<Leg>` is a blunt way to say "instantiated". The
  checkpoint's opaque `state` means a new `engineVersion` may refuse an old checkpoint (the caller
  restarts the run; runs are immutable anyway). The `Capabilities`/Zod conformance test is a
  second source of truth for the vocabulary, kept honest only by that test. No candle resampling:
  a new timeframe is an enum member plus ingested rows, not derived data (YAGNI until asked).
- **Deliberately excluded**: streaming/observer APIs, plugin registration at runtime, a generic
  `compute(request)` dispatcher, strategy parameters in the DSL, Monte Carlo (would be the first
  real user of `seed`).

## 6. Open questions for the owner

1. How is "the thesis held" determined at the horizon: by a machine-checkable predicate chosen
   from a small menu when the decision is recorded (this design), or by a free-text thesis that
   the user judges at the horizon (which ADR-0005 forbids being hand-edited)?
2. Walk-forward "optimization": should the owner author the candidate variants by hand (this
   design), or should strategies gain tunable parameters with ranges (a DSL change, ADR-0008)?
3. When a fill is missed in a backtest (no trades in the series that day), should the entry be
   retried on the following session or dropped after one attempt?
4. Should a `warn`-mode backtest size a breaching operation down to the limit, or run it at the
   requested size and flag it?
5. For the counterfactual P&L of a "do not enter" decision, which cost model applies: the user's
   configured one at decision time, or a fixed default so all counterfactuals compare?
