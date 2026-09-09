# Engine interface, design C: optimized for the common caller

Constraint: the three common callers (a server action pricing an operation being built, a route
handler running a backtest under `maxDuration`, the nightly job evaluating every active strategy
over every watchlist) get a one-call, one-input-object, one-result API; everything else is a
smaller function in the same shape. Radical choices: **the interface is the wire format** (plain
JSON in and out; decimals are strings, money is integer centavos, no `Decimal` crosses the seam),
**one data-view type for every call** (`MarketView`), **the engine truncates the view itself** (a
caller cannot leak the future because the engine discards it), and **every method is async** so
the in-process implementation can become a worker without touching a caller. The existing `money`
module is replaced: `Centavos` is a plain integer and its helpers become internal.

## 1. Interface

```ts
// ---- scalars: JSON-native, no engine object leaks --------------------------------------------
type DecimalString = string; // "12.345678"; prices scale 2, greeks/IV/percentages scale 6 (ADR-0001)
type Centavos = number; // integer BRL centavos; the only money type; never fractional
type Quantity = number; // integer shares or option units
type Ticker = string; // B3 ticker
type ISODate = string; // "YYYY-MM-DD", a trading session in America/Sao_Paulo
type Instant = string; // ISO-8601 UTC, "2026-09-08T17:30:00Z"
type AsOf = ISODate | Instant; // a date means "the close of that session"
type Timeframe = "15m" | "30m" | "60m" | "D1";

type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError };
type EngineError =
  | { code: "invalid_input"; path: string; message: string } // semantic, post-Zod
  | { code: "insufficient_data"; what: string; need: number; have: number }
  | { code: "missing_instrument"; ticker: Ticker }
  | { code: "no_price"; ticker: Ticker; at: AsOf }
  | { code: "no_volatility"; ticker: Ticker } // no price, no iv, no history
  | { code: "no_series_matches"; underlying: Ticker; rule: string }
  | { code: "checkpoint_mismatch"; reason: string };
// Nothing else is ever returned as an error. A thrown exception from the engine is a bug.

type Provenance = { version: string; pricingModel: "bsm-continuous-yield" };
type Note = {
  code:
    | "european_pricing"
    | "iv_from_average_price"
    | "intraday_option_fill_at_fair_value"
    | "short_window_not_annualized"
    | "payoff_at_nearest_expiry"
    | "corporate_action_unadjusted"
    | "stale_data";
  message: string;
};

// ---- the single data view; assembled by market-data, truncated by the engine ----------------
type Candle = {
  session: ISODate;
  closedAt: Instant;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  volume: number;
};
type OptionSeries = {
  ticker: Ticker;
  underlying: Ticker;
  type: "call" | "put";
  strike: DecimalString;
  expiry: ISODate;
  style: "american" | "european";
};
type OptionDayPrice = {
  ticker: Ticker;
  session: ISODate;
  average: DecimalString | null;
  close: DecimalString | null;
  trades: number;
};
type Quote = {
  ticker: Ticker;
  bid?: DecimalString;
  ask?: DecimalString;
  last?: DecimalString;
  at: Instant;
};
type InstrumentHistory = {
  ticker: Ticker;
  candles: Partial<Record<Timeframe, Candle[]>>; // adjusted series
  nominalCandles?: Candle[]; // D1 as traded; defaults to candles.D1
  corporateActionFactors?: Array<{ session: ISODate; factor: DecimalString }>;
  dividendYield?: DecimalString; // annual continuous; default 0
  optionSeries?: OptionSeries[];
  optionPrices?: OptionDayPrice[]; // COTAHIST daily option prices
  ivHistory?: Array<{ session: ISODate; iv: DecimalString }>; // from underlyingImpliedVolatility
};
type MarketView = {
  sessions: ISODate[]; // trading calendar over the range
  riskFree: Array<{ session: ISODate; annualRate: DecimalString }>; // CDI; latest <= asOf is used
  instruments: Record<Ticker, InstrumentHistory>;
  quotes?: Quote[]; // intraday tier; optional
};

// ---- imported as types from @fetha/contracts (Zod lives there) ------------------------------
// StrategyDefinition, StructureTemplate, StrikeSelection, ExpirySelection, IndicatorSpec,
// SizingRule, CostModel, RiskProfile, Leg, Fill, ThesisClaim.
type Leg = {
  role: "stock" | "call" | "put";
  side: "buy" | "sell";
  quantity: Quantity;
  ticker: Ticker;
  price?: DecimalString;
  iv?: DecimalString;
}; // price absent => quote from the view
type Operation = {
  id: string;
  underlying: Ticker;
  legs: Leg[];
  openedAt: ISODate;
  strategyVersionId?: string;
}; // legs carry entry prices
type StrategyVersion = { id: string; definition: StrategyDefinition };

// ---- pricing -------------------------------------------------------------------------------
type Greeks = {
  delta: DecimalString;
  gamma: DecimalString;
  theta: DecimalString;
  vega: DecimalString;
  rho: DecimalString;
};
type OptionPricing = {
  ticker: Ticker;
  priceUsed: DecimalString | null;
  priceSource: "given" | "mid" | "last" | "average" | null;
  fairValue: DecimalString | null;
  iv: DecimalString | null;
  greeks: Greeks | null;
  timeToExpiryYears: DecimalString;
  note?: Note; // per-series failure is a null, not an error
};
type PayoffPoint = { underlying: DecimalString; pnl: Centavos };
type LimitBreach = {
  limit:
    | "max_loss_per_operation"
    | "max_exposure_per_operation"
    | "max_open_operations"
    | "max_premium_bought";
  value: Centavos | number;
  allowed: Centavos | number;
};
type OperationPricing = {
  at: AsOf;
  spot: DecimalString;
  riskFreeRate: DecimalString;
  dividendYield: DecimalString;
  legs: Array<Leg & OptionPricing>;
  netPremium: Centavos; // negative = debit paid
  greeks: Greeks; // quantity- and side-weighted
  payoff: PayoffPoint[]; // at expiry, grid spanning the strikes
  breakEvens: DecimalString[];
  maxLoss: Centavos | "unbounded";
  maxGain: Centavos | "unbounded";
  limits: LimitBreach[]; // empty without a risk profile
  notes: Note[];
  engine: Provenance;
};

// ---- strategy evaluation (nightly and intraday catch-up are the same call) ---------------------
type EvaluateStrategyInput = {
  strategy: StrategyVersion;
  instrument: Ticker;
  view: MarketView;
  at: AsOf; // evaluation time
  since?: AsOf; // exclusive; evaluates every candle closed in (since, at]
  openOperations?: Operation[]; // this strategy's, on this instrument, for exit/adjust rules
  riskProfile?: RiskProfile;
  declaredCapital?: Centavos;
};
type Signal = {
  strategyVersionId: string;
  instrument: Ticker;
  timeframe: Timeframe;
  at: Instant;
  session: ISODate;
  kind: "entry" | "exit" | "adjust" | "none" | "no_series";
  conditions: Array<{ expression: string; value: DecimalString | boolean }>;
  proposal?: { legs: Leg[]; quantity: Quantity; sizing: SizingRule; pricing: OperationPricing };
  operationId?: string;
  reason?: string;
};
type Evaluation = {
  signals: Signal[];
  candlesEvaluated: number;
  notes: Note[];
  engine: Provenance;
};

// ---- backtest --------------------------------------------------------------------------------
type BacktestInput = {
  strategy: StrategyVersion;
  universe: Ticker[];
  period: { from: ISODate; to: ISODate };
  initialCapital: Centavos;
  costModel: CostModel;
  sizing: SizingRule;
  riskProfile: RiskProfile;
  limitMode?: "enforce" | "warn"; // default "enforce" (ADR-0004)
  walkForward?: { windows: number };
  seed?: number; // default 0; only resampling metrics consume it
  view: MarketView;
};
type SimulatedFill = {
  operationId: string;
  session: ISODate;
  at: Instant;
  ticker: Ticker;
  side: "buy" | "sell";
  quantity: Quantity;
  price: DecimalString;
  source: "next_open" | "next_average" | "fair_value";
  costs: Centavos;
};
type MissedFill = {
  operationId: string;
  session: ISODate;
  ticker: Ticker;
  reason: "no_trades" | "limit_breach";
};
type SimulatedOperation = Operation & {
  closedAt?: ISODate;
  exitReason?: string;
  pnl: Centavos;
  maxLoss: Centavos | "unbounded";
};
type EquityPoint = { session: ISODate; equity: Centavos; cash: Centavos; drawdown: DecimalString };
type BacktestMetrics = {
  totalReturn: DecimalString;
  cagr: DecimalString | null;
  sharpe: DecimalString | null; // null = not annualized
  maxDrawdown: DecimalString;
  winRate: DecimalString;
  profitFactor: DecimalString | null;
  operations: number;
  exposure: DecimalString;
  fees: Centavos;
  taxes: Centavos;
  slippage: Centavos;
};
type WalkForwardWindow = { from: ISODate; to: ISODate; metrics: BacktestMetrics };
type BacktestRun = {
  config: Omit<BacktestInput, "view"> & { viewFingerprint: string };
  operations: SimulatedOperation[];
  fills: SimulatedFill[];
  missedFills: MissedFill[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  walkForward?: WalkForwardWindow[];
  limitBreaches: LimitBreach[];
  notes: Note[];
  engine: Provenance;
};
type BacktestCheckpoint = { v: 1; viewFingerprint: string; cursor: ISODate; state: unknown }; // opaque, JSON
type BacktestProgress =
  | { status: "complete"; run: BacktestRun }
  | {
      status: "paused";
      checkpoint: BacktestCheckpoint;
      sessionsDone: number;
      sessionsTotal: number;
    };

// ---- portfolio, settlement, scoring, indicators, IV index -----------------------------------
type Position = { ticker: Ticker; quantity: Quantity; averageCost: DecimalString };
type PortfolioValuation = {
  at: AsOf;
  positions: Array<Position & { price: DecimalString; value: Centavos; unrealizedPnl: Centavos }>;
  operations: Array<{ operation: Operation; pricing: OperationPricing; unrealizedPnl: Centavos }>;
  totals: { equity: Centavos; cash: Centavos; unrealizedPnl: Centavos; greeks: Greeks };
  notes: Note[];
  engine: Provenance;
};
type SettlementProposal = {
  operationId: string;
  expiry: ISODate;
  spot: DecimalString;
  legs: Array<{
    ticker: Ticker;
    outcome: "exercised" | "assigned" | "expired" | "kept";
    proposedFill?: Fill;
  }>;
  notes: Note[];
  engine: Provenance;
};
type ScoreInput = {
  subject: {
    kind: "enter" | "do_not_enter" | "hold" | "adjust" | "exit" | "analysis";
    at: AsOf;
    confidence: DecimalString;
    claim?: ThesisClaim;
  };
  operation: Operation; // real, or the proposed one for do_not_enter/analysis
  realizedFills?: Fill[]; // the user's fills on it through the horizon
  horizon: AsOf;
  costModel: CostModel;
  view: MarketView;
};
type Score = {
  pnl: Centavos;
  maxLoss: Centavos | "unbounded";
  normalizedPnl: DecimalString | null;
  thesis: { held: boolean | null; brier: DecimalString | null }; // null when no checkable claim
  counterfactualPnl: Centavos | null; // do_not_enter only
  inputsUsed: string[];
  notes: Note[];
  engine: Provenance;
};
type IndicatorSeries = {
  indicator: IndicatorSpec;
  values: Array<{ closedAt: Instant; value: DecimalString | null }>;
};

// ---- the seam ---------------------------------------------------------------------------------
export interface Engine {
  readonly version: string;
  priceOptions(i: {
    tickers: Ticker[];
    view: MarketView;
    at: AsOf;
  }): Promise<Result<OptionPricing[]>>;
  priceOperation(i: {
    legs: Leg[];
    view: MarketView;
    at: AsOf;
    riskProfile?: RiskProfile;
    declaredCapital?: Centavos;
    openOperations?: number;
  }): Promise<Result<OperationPricing>>;
  instantiateStructure(i: {
    structure: StructureTemplate;
    underlying: Ticker;
    strikes: StrikeSelection;
    expiry: ExpirySelection;
    quantity: Quantity;
    view: MarketView;
    at: AsOf;
  }): Promise<Result<Leg[]>>;
  evaluateStrategy(i: EvaluateStrategyInput): Promise<Result<Evaluation>>;
  runBacktest(
    i: BacktestInput,
    resume?: { checkpoint?: BacktestCheckpoint; maxSessions?: number },
  ): Promise<Result<BacktestProgress>>;
  markToMarket(i: {
    positions: Position[];
    operations: Operation[];
    cash: Centavos;
    view: MarketView;
    at: AsOf;
  }): Promise<Result<PortfolioValuation>>;
  proposeSettlement(i: {
    operation: Operation;
    view: MarketView;
    expiry: ISODate;
  }): Promise<Result<SettlementProposal>>;
  score(i: ScoreInput): Promise<Result<Score>>;
  computeIndicator(i: {
    indicator: IndicatorSpec;
    instrument: Ticker;
    timeframe: Timeframe;
    view: MarketView;
    at?: AsOf;
  }): Promise<Result<IndicatorSeries>>;
  underlyingImpliedVolatility(i: {
    underlying: Ticker;
    view: MarketView;
    session: ISODate;
  }): Promise<Result<{ session: ISODate; iv: DecimalString; method: "atm_30d_interpolated" }>>;
}
export const engine: Engine; // the in-process implementation; also the reference for any other
```

**Invariants** (each is a property test in `packages/engine`):

- I1 Future-blind: for every method taking `at`, `f(view ∪ anything with session/closedAt > at, at)`
  deep-equals `f(view, at)`. Truncation rule: a date `at` keeps rows with `session <= at`; an
  instant keeps `closedAt <= at` (quotes: `at <= at`). Inside a backtest the evaluator sees the view
  truncated at each session in turn; fills happen in the next session or candle (ADR-0004/0011).
- I2 Chunk-invariance: any sequence of `runBacktest` calls with any `maxSessions` values produces a
  `run` deep-equal to the single uninterrupted call.
- I3 Order-invariance: arrays in `MarketView` may arrive in any order; the engine sorts. Duplicate
  keys (same `ticker`+`closedAt`, same `ticker`+`session`) return `invalid_input`.
- I4 Determinism: identical inputs give deep-equal outputs; no clock, no `Math.random`, no
  environment read. `seed` is the only entropy and defaults to `0`.
- I5 Numeric discipline: no price, rate, greek or ratio is ever a JS `number`; every `Centavos`
  and `Quantity` is an integer; decimals are emitted at ADR-0001 scales.
- I6 Provenance: every artifact carries `engine.version`, `pricingModel` and `notes` naming each
  approximation applied (ADR-0002 European pricing, ADR-0011 fair-value fills), so the AI layer and
  the journal cite them.

**Ordering constraints.** `MarketView.sessions` must cover `[period.from - warmup, max expiry]` for
backtests and `[at, max expiry]` for pricing, or `insufficient_data` is returned naming what is
missing. `evaluateStrategy` with `since` requires the strategy timeframe's candles over
`(since, at]`. `runBacktest` with a `checkpoint` requires the same `viewFingerprint` (a hash of the
view rows the run can see), otherwise `checkpoint_mismatch`; a caller may trim the view to
`[cursor - warmup, period.to]` only if it recomputes nothing else, and the fingerprint covers only
rows `>= cursor - warmup` to allow that.

**Error modes.** All expected failures are `Result` errors listed above, one per call. Partial
failure inside a batch is a `null` with a `note` on the item (`priceOptions`, legs inside
`priceOperation` when a fair value can still be produced from a given `iv`). `evaluateStrategy`
never fails because a series selection found nothing: it emits `kind: "no_series"` with `reason`
(ADR-0008). A backtest with a missed fill records it and continues.

**Performance characteristics** (in-process, single thread, decimal arithmetic):

- `priceOptions`: O(n) with a bounded root finder (≤ 64 iterations); ~2–5k series per second.
- `priceOperation`, `markToMarket`, `proposeSettlement`, `score`: O(legs + payoff grid); milliseconds.
- `evaluateStrategy`: O(lookback candles + chain size) per evaluation time; nightly over 30
  instruments × 10 strategies stays well under a second per user.
- `runBacktest`: O(sessions × universe × (indicator update + chain filter)); indicators are
  incremental. Expect 1–5k session-instrument steps per second; a 10-year daily run over 20 tickers
  is ~50k steps, so a route handler should run in chunks of a few thousand sessions and persist the
  checkpoint (~kB per year of equity curve). Fingerprinting is O(view size) per call.

## 2. Usage examples

Pricing in a server action (the user is building a collar on PETR4):

```ts
const view = await marketData.view({
  tickers: ["PETR4"],
  through: today,
  tiers: ["reference", "intraday"],
});
const r = await engine.priceOperation({ legs, view, at: nowInstant, riskProfile, declaredCapital });
if (!r.ok) return { error: r.error }; // typed, rendered as a pt-BR message
return r.value; // payoff, greeks, break-evens, max loss, limits
```

Chunked backtest in a route handler with `maxDuration` (checkpoint persisted between requests):

```ts
const started = Date.now();
let checkpoint = await runs.loadCheckpoint(runId); // undefined on the first request
while (true) {
  const r = await engine.runBacktest(input, { checkpoint, maxSessions: 1500 });
  if (!r.ok) return fail(runId, r.error);
  if (r.value.status === "complete") return complete(runId, r.value.run);
  ({ checkpoint } = r.value);
  await runs.saveCheckpoint(runId, checkpoint, r.value.sessionsDone);
  if (Date.now() - started > budgetMs) return accepted(runId); // the client re-calls; same input
}
```

Nightly evaluation (one loop; the engine is called once per strategy version × instrument):

```ts
for (const user of users) {
  const view = await marketData.view({
    tickers: user.watchlist,
    through: session,
    tiers: ["reference"],
  });
  for (const strategy of user.activeDailyStrategies)
    for (const instrument of user.watchlist) {
      const r = await engine.evaluateStrategy({
        strategy,
        instrument,
        view,
        at: session,
        openOperations: await portfolio.openOperations(user, strategy.id, instrument),
        riskProfile: user.riskProfile,
        declaredCapital: user.declaredCapital,
      });
      if (r.ok)
        await signals.deposit(
          user,
          r.value.signals.filter((s) => s.kind !== "none"),
        );
    }
}
```

Intraday catch-up on reopening (same call, `since` = last evaluation, caller marks late):

```ts
const r = await engine.evaluateStrategy({
  ...common,
  at: lastClosedCandle,
  since: lastEvaluatedAt,
});
if (r.ok)
  await signals.deposit(
    user,
    r.value.signals.map((s) => ({ ...s, late: s.at < lastClosedCandle })),
  );
```

Scoring at horizon (decisions and analyses through the same call):

```ts
const view = await marketData.view({
  tickers: [op.underlying, ...op.legs.map((l) => l.ticker)],
  through: horizon,
});
const r = await engine.score({
  subject: {
    kind: decision.kind,
    at: decision.at,
    confidence: decision.confidence,
    claim: decision.thesis.claim,
  },
  operation: op,
  realizedFills,
  horizon,
  costModel: defaults,
  view,
});
```

## 3. What the implementation hides behind the seam

- Decimal arithmetic: `decimal.js` instances are created on entry and serialized on exit; the
  library is replaceable without any caller noticing. Rounding policy per ADR-0001 scales.
- Pricing: BSM with continuous dividend yield, analytic greeks, Brent/Newton root finding for IV
  with bracketing and the `no_volatility` fallback chain (given `iv` → given `price` → mid → last →
  COTAHIST average with note). Business-day time to expiry over `sessions` (B3 convention, 252).
  A CRR model for American exercise later changes `pricingModel` and nothing else (ADR-0002).
- The DSL interpreter: condition tree evaluation, indicator registry (SMA, EMA, RSI, ATR, IV rank
  over `ivHistory`, ...), incremental indicator state during backtests, strike selection by delta,
  moneyness or nearest, expiry by business-day window, exit and adjustment rules.
- The simulator: next-session/next-candle fill queue, `PREMED` fills with slippage, fair-value
  fills for intraday options (ADR-0011), cost model (B3 fees, brokerage, monthly income tax with the
  R$ 20.000 stock exemption and no loss carry-forward), fixed-fractional and fixed-risk sizing,
  limit enforcement or warning, corporate-action factors applied to held positions, equity curve
  and drawdown, metrics, walk-forward windowing, checkpoint encoding and fingerprinting.
- Payoff geometry: strike grid, break-even root finding, unbounded detection, aggregation of greeks.
- Settlement logic for calls and puts at expiry, including assignment of short legs.
- Scoring math: normalized P&L, Brier term, counterfactual simulation via the same fill queue.
- The IV index method (`atm_30d_interpolated`), which the ingestion job persists as `ivHistory`.

None of this appears in a type a caller uses; the caller vocabulary is the glossary plus `MarketView`.

## 4. Dependency strategy

- **Injected**: nothing at runtime. `engine` is a constant object; `Engine` is the type a worker
  adapter (`apps/web` posting JSON to a worker running the same package) or a future implementation
  satisfies. Pricing-model choice is not injectable in v1 (YAGNI; ADR-0002 fixes BSM); when CRR
  arrives it becomes an input field, not a constructor option.
- **Data**: time (`at`, `horizon`, `since`), market data, calendar and rates (`MarketView`), user
  configuration (`RiskProfile`, `CostModel`, `SizingRule`, `declaredCapital`), strategy and
  structure definitions, the `seed`. All arrive as arguments; the engine never reads a clock, an
  env var or a store.
- **Type-only imports** from `@fetha/contracts` for edge-originated shapes (`StrategyDefinition`,
  `StructureTemplate`, `StrikeSelection`, `ExpirySelection`, `IndicatorSpec`, `SizingRule`,
  `CostModel`, `RiskProfile`, `Leg`, `Fill`, `ThesisClaim`): types derive from Zod exactly once and
  the direction is `engine → contracts`, never back. The engine declares `MarketView` and every
  output type; `apps/web` maps provider payloads and rows to `MarketView`.
- Runtime dependency: `decimal.js` only. No framework, no Node built-ins.

## 5. Trade-offs

High leverage:

- One `MarketView` for all ten methods gives `market-data` one job (`view(...)`) and every caller
  the same two lines; the intraday tier adds `quotes` and `candles["15m"]`, not a call shape.
  Truncation inside the engine makes look-ahead impossible by construction and testable by
  property (I1) rather than by discipline.
- Wire-format types remove a serialization layer between engine, database (Drizzle `numeric` is
  already a string) and the AI artifact: the object returned to the server action is the object
  stored and the object sent to the model, with `Provenance` and `notes` riding along.
- `evaluateStrategy` covering nightly and catch-up with one optional field means one code path,
  one test suite and one signal shape in the inbox. Async methods make "swap in a worker" a
  one-file change in `apps/web`. Chunking by `maxSessions` keeps the engine clock-free while the
  route handler owns its `maxDuration` budget.

Thin or awkward:

- The builder pays for uniformity: pricing three legs means assembling a `MarketView` with
  `sessions` and `riskFree` instead of passing `spot` and `rate` scalars. Mitigated because
  `market-data.view()` is the only way callers obtain data anyway.
- Passing the whole view on every backtest chunk is O(view) per request (tens of MB for ten years
  over twenty tickers). Acceptable for v1; the fingerprint rule already permits trimming the view
  to `[cursor - warmup, to]` when it hurts.
- The checkpoint `state` is opaque and versioned (`v: 1`): an engine upgrade refuses old
  checkpoints (`checkpoint_mismatch`) rather than misreading them, so a run paused across a deploy
  restarts. Restarts are cheap; correctness wins.
- Charts call `computeIndicator` once per overlay; no batch form. Milliseconds each; left as is.
- `instantiateStructure` exists only for the builder's "pre-fill from selection rules" flow; it is
  the one method the common callers never touch and the first to fold away if that flow never ships.
- Multi-expiry structures get a payoff at the nearest expiry with later legs at fair value
  (`payoff_at_nearest_expiry`); walk-forward without DSL parameters is rolling out-of-sample
  windows, not optimization. See questions 2 and 4.
- Replacing the `money` module drops `currency` and `formatBRL` from the engine: formatting is a UI
  concern and BRL is the only currency (ADR-0001).

## 6. Open questions for the owner

1. **Thesis checkability.** For the Brier component (ADR-0005), must a thesis include a
   machine-checkable claim from a closed vocabulary (for example "PETR4 close above R$ 40 by the
   horizon", "operation P&L positive at the horizon"), or may a thesis be free text with the user
   marking held/failed at the horizon? The engine can only score what it can check; free-text
   theses would score `held: null` and count only on P&L.
2. **Walk-forward semantics.** Strategies have no free parameters (ADR-0008), so walk-forward can
   only report per-window out-of-sample metrics. Do you want parameter ranges in the DSL (for
   example `sma(10..50)`) so the engine optimizes on one window and tests on the next? This would
   amend ADR-0008 and add a real optimizer to the engine.
3. **Counterfactual exit rule.** For "do not enter", should the operation not taken be closed by
   the strategy's own exit rules (when the decision came from a signal) or simply marked to market
   at the horizon? The two can disagree by a lot on options.
4. **Multi-expiry structures in v1.** Calendars and diagonals need a payoff convention (nearest
   expiry with later legs at fair value, as designed) or exclusion from the catalog until a payoff
   surface exists. Which do you prefer?
5. **Pricing without a risk profile.** When a user has not declared capital yet, should the
   builder price the operation with a "no risk profile" note or refuse until the profile exists?
