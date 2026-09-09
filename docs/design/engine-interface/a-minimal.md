# Engine interface, design A: minimal

Constraint for this design: the fewest entry points that still carry every computation Fetha
needs, with maximum leverage per entry point. The result is two functions and one data protocol.
The engine is a pure function from `(data view, question)` to `answer`; a backtest is the same
function folded over time with a serializable checkpoint carried by the caller.

Everything crossing the seam is JSON-compatible data. Callers never touch `decimal.js`: decimals
travel as strings, money as integer centavos, quantities as integers. The interface is therefore a
message protocol, so a worker, a WASM build or another language can replace the implementation
without a caller changing.

## 1. Interface

```ts
// packages/engine/src/index.ts — the whole public surface

export const ENGINE_VERSION: string;

export function compute<K extends Query["kind"]>(
  view: DataView,
  query: Extract<Query, { kind: K }>,
): Result<ArtifactOf<K>>;

export function step(
  view: DataView,
  input: { config: BacktestConfig } | { checkpoint: Checkpoint },
  budget?: { maxSessions: number },
): Result<StepOutput>;
```

### Wire scalars

```ts
export type Dec = string; // decimal literal ("12.34", "-0.000125"); scales per ADR-0001
export type Centavos = number; // integer, BRL; never fractional
export type Qty = number; // integer shares or option units
export type Ticker = string; // B3 ticker, the instrument id
export type ISODate = string; // "2026-09-08", a trading session
export type Instant = string; // "2026-09-08T18:00:00Z", a candle close or an evaluation time
export type Timeframe = "15m" | "30m" | "60m" | "D1";
```

### Types imported from `@fetha/contracts` (type-only, erased at runtime)

`StrategyDefinition`, `Condition`, `IndicatorSpec`, `Structure`, `StrikeSelection`,
`ExpirySelection`, `SizingRule`, `CostModel`, `RiskProfile`. These are the user-authored or
catalog-authored documents whose Zod schemas own the closed vocabulary (ADR-0008). The engine
declares every other type below. `contracts` never imports `engine`.

### Data view: the only way data enters

```ts
export type Candle = { t: Instant; o: Dec; h: Dec; l: Dec; c: Dec; v: Qty };
export type DailyOptionPrice = {
  date: ISODate;
  avg: Dec;
  close: Dec;
  trades: number;
  openInterest: Qty;
};
export type Factor = { exDate: ISODate; factor: Dec }; // corporate-action factor
export type Quote = { t: Instant; last: Dec; bid?: Dec; ask?: Dec };

export type InstrumentData =
  | {
      kind: "stock" | "etf";
      candles: Partial<Record<Timeframe, Candle[]>>;
      factors: Factor[];
      dividendYield?: Dec;
      quote?: Quote;
    }
  | {
      kind: "option";
      underlying: Ticker;
      type: "call" | "put";
      strike: Dec;
      expiry: ISODate;
      style: "american" | "european";
      daily: DailyOptionPrice[];
      quote?: Quote;
    };

export type DataView = {
  asOf: Instant; // evaluation time; nothing later is ever read
  sessions: ISODate[]; // trading sessions covering the view, ascending
  riskFree: { date: ISODate; annual: Dec }[]; // CDI/Selic series
  instruments: Record<Ticker, InstrumentData>; // nominal candles; the engine derives adjusted
};
```

The view is a bag of facts, not a capability object. The no-look-ahead guarantee does not depend
on the caller building it carefully: the engine drops every candle, quote, option price and rate
later than `asOf` before any computation, and for each internal evaluation time `t <= asOf` it
evaluates against a copy truncated at `t`. Dropped rows are reported in `Meta.truncated` so a
sloppy view builder is visible in tests, not in results.

### Shared domain values

```ts
export type Leg = { instrument: Ticker; side: "buy" | "sell"; qty: Qty; price?: Dec };
export type Fill = {
  instrument: Ticker;
  side: "buy" | "sell";
  qty: Qty;
  price: Dec;
  at: Instant;
  costs: Centavos;
};
export type Operation = {
  id: string;
  legs: Leg[];
  openedAt: Instant;
  status: "open" | "adjusted" | "closed" | "expired";
  rolledFrom?: string;
};
export type Position = { instrument: Ticker; qty: Qty; avgCost: Dec };
export type Greeks = { delta: Dec; gamma: Dec; theta: Dec; vega: Dec; rho: Dec };
export type LimitBreach = { limit: keyof RiskProfile; value: Dec; max: Dec };
export type LegSelection = {
  structure: Structure;
  underlying: Ticker;
  strikes: StrikeSelection;
  expiry: ExpirySelection;
  qty: Qty | SizingRule;
};
```

### Queries and artifacts

```ts
export type Query =
  | { kind: "requirements"; strategy: StrategyDefinition }
  | { kind: "indicators"; instrument: Ticker; timeframe: Timeframe; indicators: IndicatorSpec[] }
  | { kind: "price"; legs: Leg[] | LegSelection; riskProfile?: RiskProfile }
  | {
      kind: "signals";
      strategy: StrategyDefinition;
      instruments: Ticker[];
      since?: Instant;
      openOperations?: Operation[];
    }
  | {
      kind: "portfolio";
      cash: Centavos;
      positions: Position[];
      operations: Operation[];
      riskProfile?: RiskProfile;
    }
  | { kind: "score"; decision: DecisionInput; analysis?: { confidence: Dec } };

type ArtifactMap = {
  requirements: Requirements;
  indicators: IndicatorSeries;
  price: Valuation;
  signals: Signal[];
  portfolio: PortfolioValuation;
  score: Score;
};
export type ArtifactOf<K extends Query["kind"]> = ArtifactMap[K];

export type Requirements = {
  timeframes: Timeframe[];
  lookbackCandles: Record<Timeframe, number>;
  needsChain: boolean;
  needsRiskFree: boolean;
};

export type IndicatorSeries = {
  candles: Candle[]; // adjusted series
  values: Record<string, (Dec | null)[]>;
}; // one column per spec, aligned

export type LegValuation = {
  leg: Leg;
  mark: Dec | null;
  fairValue: Dec | null;
  iv: Dec | null;
  ivStatus: "ok" | "no_market_price" | "below_intrinsic" | "no_convergence" | "not_an_option";
  greeks: Greeks | null;
};
export type Valuation = {
  legs: LegValuation[];
  greeks: Greeks;
  netPremium: Centavos;
  payoff: { price: Dec; pnl: Centavos }[];
  breakEvens: Dec[];
  maxLoss: Centavos | "unbounded";
  maxGain: Centavos | "unbounded";
  limitBreaches: LimitBreach[];
};

export type Signal = {
  evaluationTime: Instant;
  instrument: Ticker;
  fired: Record<string, Dec>;
  outcome:
    | { kind: "entry"; legs: Leg[]; valuation: Valuation }
    | { kind: "exit" | "adjust"; operationId: string; rule: string }
    | { kind: "none"; reason?: "conditions_not_met" | "no_series_match" | "insufficient_data" };
};

export type Settlement = {
  operationId: string;
  instrument: Ticker;
  expiry: ISODate;
  outcome: "exercised" | "assigned" | "expired_worthless";
  underlyingClose: Dec;
  proposedFills: Fill[];
};
export type PortfolioValuation = {
  total: Centavos;
  cash: Centavos;
  greeks: Greeks;
  positions: (Position & {
    mark: Dec | null;
    value: Centavos | null;
    unrealized: Centavos | null;
  })[];
  operations: { id: string; valuation: Valuation; unrealized: Centavos }[];
  limitBreaches: LimitBreach[];
  settlements: Settlement[];
};

export type DecisionInput = {
  kind: "enter" | "do_not_enter" | "hold" | "adjust" | "exit";
  decidedAt: Instant;
  horizon: ISODate;
  confidence: Dec;
  thesisHeld: boolean | Condition;
  legs: Leg[];
  costModel: CostModel;
};
export type Score = {
  pnl: Centavos | null;
  pnlOverMaxLoss: Dec | null;
  thesisHeld: boolean;
  brier: Dec;
  counterfactualPnl: Centavos | null;
};
```

### Backtest fold

```ts
export type BacktestConfig = {
  strategy: StrategyDefinition;
  universe: Ticker[];
  period: { from: ISODate; to: ISODate };
  capital: Centavos;
  costModel: CostModel;
  sizing: SizingRule;
  riskProfile: RiskProfile;
  limits: "enforce" | "warn";
  walkForward?: { windows: number; inSampleFraction: Dec };
  seed: number;
};

export type Checkpoint = { engineVersion: string; cursor: ISODate; state: unknown }; // opaque, JSON

export type StepOutput =
  | {
      status: "partial";
      checkpoint: Checkpoint;
      progress: { sessionsDone: number; sessionsTotal: number };
    }
  | { status: "complete"; run: BacktestRun };

export type Metrics = {
  totalReturn: Dec;
  cagr: Dec | null;
  maxDrawdown: Dec;
  sharpe: Dec | null;
  winRate: Dec;
  profitFactor: Dec | null;
  trades: number;
  exposure: Dec;
  feesPaid: Centavos;
  taxesPaid: Centavos;
};
export type BacktestRun = {
  config: BacktestConfig;
  operations: (Operation & { pnl: Centavos })[];
  fills: Fill[];
  missedEntries: { session: ISODate; instrument: Ticker; reason: string }[];
  limitBreaches: (LimitBreach & { session: ISODate })[];
  equityCurve: { date: ISODate; equity: Centavos }[];
  metrics: Metrics;
  walkForward?: {
    window: { from: ISODate; to: ISODate };
    inSample: Metrics;
    outOfSample: Metrics;
  }[];
};
```

### Result envelope and errors

```ts
export type Meta = {
  engineVersion: string;
  pricingModel: "bsm-european";
  approximations: (
    | "european_for_american_call"
    | "intraday_option_fill_at_fair_value"
    | "short_window_no_annualization"
  )[];
  truncated: {
    instrument: Ticker;
    timeframe: Timeframe | "daily_option" | "quote" | "rate";
    dropped: number;
  }[];
};

export type EngineError =
  | { code: "invalid_input"; path: string; message: string }
  | {
      code: "insufficient_data";
      instrument: Ticker;
      timeframe: Timeframe;
      neededFrom: Instant;
      availableFrom: Instant | null;
    }
  | { code: "view_behind_cursor"; cursor: ISODate; viewEnds: ISODate }
  | { code: "checkpoint_incompatible"; checkpointVersion: string; engineVersion: string };

export type Result<T> = { ok: true; value: T; meta: Meta } | { ok: false; error: EngineError };
```

### Invariants

- Purity: no I/O, no clock, no `Math.random`. `compute` uses no randomness at all; `step` draws
  only from `config.seed` (walk-forward window sampling, tie-breaks). Same inputs, same bytes.
- No look-ahead by construction: every evaluation at time `t` sees a view truncated at `t`; in
  `step`, a signal at session D is filled with D+1 data only (ADR-0004), and the fill path is the
  only code that reads D+1. Property test: shifting future rows never changes signals at D.
- Chunk invariance: `step` over any partition of the period into chunks yields a `BacktestRun`
  byte-identical to one uninterrupted call. Property test with random `maxSessions`.
- Costs always charged; `limits: "enforce"` refuses breaching entries and records them, `"warn"`
  fills them and records them. There is no "no costs" mode.
- All artifacts are plain JSON; `JSON.parse(JSON.stringify(x))` is the identity on inputs and
  outputs. Decimal strings are canonical (no exponent, no trailing zeros beyond the scale).
- Any figure the AI layer receives is a field of an artifact; the artifact is the citation.

### Ordering constraints

- `DataView.sessions` and every series ascend by time; the engine rejects otherwise
  (`invalid_input`), it never sorts silently.
- `signals.since < view.asOf`; evaluation times are the candle closes of the strategy's
  timeframe in `(since, asOf]`. Omitting `since` evaluates once, at `asOf`.
- `step`: the view must contain the session after `checkpoint.cursor` (else `view_behind_cursor`)
  and lookback per `requirements`; `asOf` is at or after the close of the last fill session the
  chunk will need. The engine advances while data, budget and period allow, then returns.
- A `Checkpoint` is only valid for the `engineVersion` that produced it; a mismatch is an error
  and the caller restarts the run from `config`.

### Performance characteristics

- Decoding cost: O(rows in view) string-to-decimal parsing per call. A view for one instrument
  over 10 years daily is ~2.5k rows; a nightly watchlist of 30 instruments with a 200-candle
  lookback is ~6k rows. Negligible against a Route Handler budget.
- `price`: O(legs × ~50 root-finding iterations); milliseconds.
- `signals`: O(evaluation times × instruments × indicator lookback); catch-up over a day of 15m
  candles for 30 instruments is ~800 evaluations; sub-second.
- `step`: linear in sessions × universe; `maxSessions` lets the caller size a chunk against
  `maxDuration`. Checkpoint size grows with closed operations and the equity curve (tens of KB
  for a decade of daily data), fine for a Postgres `jsonb` column between chunks.

## 2. Usage examples

Pricing a structure in a server action:

```ts
const view = await marketData.viewFor(user, {
  instruments: [underlying, ...chainTickers],
  asOf: now,
});
const result = compute(view, {
  kind: "price",
  legs: {
    structure: collar,
    underlying: "PETR4",
    strikes: bySelection,
    expiry: byWindow,
    qty: 100,
  },
  riskProfile: profile,
});
if (!result.ok) return result.error; // typed value, rendered by the UI
return { valuation: result.value, meta: result.meta }; // the AI later receives exactly this JSON
```

A chunked backtest in a route handler (`maxDuration` raised):

```ts
let input = job.checkpoint ? { checkpoint: job.checkpoint } : { config: job.config };
const req = compute(emptyView, { kind: "requirements", strategy: job.config.strategy });
const view = await marketData.viewFor(user, windowAfter(job, req.value, CHUNK_SESSIONS));
const out = step(view, input, { maxSessions: CHUNK_SESSIONS });
if (!out.ok) return failJob(job, out.error);
if (out.value.status === "partial") {
  await saveCheckpoint(job, out.value.checkpoint);
  return reschedule(job);
}
await saveRun(user, out.value.run, out.meta); // immutable; running again creates a new run
```

Nightly evaluation (cron, all users, daily strategies):

```ts
for (const { user, strategy, watchlist, openOperations } of activeDailyStrategies) {
  const view = await marketData.viewFor(user, {
    instruments: watchlist,
    asOf: sessionClose(today),
    ...req,
  });
  const r = compute(view, { kind: "signals", strategy, instruments: watchlist, openOperations });
  if (r.ok)
    await inbox.deposit(
      user,
      r.value.filter((s) => s.outcome.kind !== "none"),
    );
}
```

Intraday catch-up (client asks after reopening; one strategy, candles since last evaluation):

```ts
const view = await marketData.viewFor(user, {
  instruments: watchlist,
  asOf: lastClosedCandle,
  ...req,
});
const r = compute(view, {
  kind: "signals",
  strategy,
  instruments: watchlist,
  since: lastEvaluation,
  openOperations,
});
// the app marks signals with evaluationTime < now - one timeframe as late (ADR-0010)
```

Scoring at horizon:

```ts
const view = await marketData.viewFor(user, {
  instruments: legTickers,
  from: decision.decidedAt,
  asOf: horizonClose,
});
const r = compute(view, {
  kind: "score",
  decision: {
    kind: "do_not_enter",
    decidedAt,
    horizon,
    confidence: "0.7",
    thesisHeld: thesisCondition,
    legs: contemplatedLegs,
    costModel,
  },
  analysis: { confidence: analysis.confidence },
});
```

## 3. What the implementation hides behind the seam

- Decimal arithmetic: parsing, canonical formatting, scales, rounding rules (ADR-0001). Callers
  see strings and integers only. The current `money` module becomes internal (its `formatBRL`
  belongs to the UI's pt-BR formatting, not to the engine).
- Corporate-action adjustment: the view carries nominal candles plus factors; the engine builds
  the adjusted series for indicators and keeps nominal for strikes and option prices.
- Indicator implementations and their warm-up rules; the `IndicatorSpec` vocabulary is the only
  thing exposed.
- BSM with dividend yield, analytic greeks, IV root finding and its bracketing; the pricing model
  is reported in `Meta`, and a CRR extension changes `pricingModel`, not the shape.
- Structure instantiation: strike by delta, moneyness or nearest; expiry by business-day window
  over `sessions`; chain filtering; sizing rules; limit checks.
- The strategy interpreter (condition tree over indicators and price fields), per-evaluation-time
  truncation, catch-up iteration.
- The whole backtest state machine: pending signals, D+1 fills (open for stocks, `avg` plus
  slippage for options, intraday option fills at fair value with the day's closing IV per
  ADR-0011), cost model with B3 fees, brokerage and the simplified monthly income tax, missed
  entries, expiry settlement, equity curve, metrics, walk-forward windows, seeded tie-breaks.
- Scoring math (ADR-0005), including the counterfactual mini-simulation that reuses the fill
  model over the same view.
- The checkpoint's internal layout: callers persist it as an opaque `jsonb`, never read it.

## 4. Dependency strategy

- Dependency category: in-process pure computation. Runtime dependency: `decimal.js` only.
- Injected: nothing executable. The only injectables are data: `config.seed` (randomness),
  `DataView.asOf` (time), `riskFree` (rates), the strategy, cost model, sizing rule and risk
  profile documents. No pricing-model port in v1: the model is fixed by ADR-0002 and reported in
  `Meta`; adding CRR later adds an optional `pricingModel` field to the queries that price, which
  is additive and does not break the frozen shape.
- Type-only imports from `@fetha/contracts` for user- and catalog-authored documents, so "types
  derive from schemas" holds and the engine adds no runtime edge. `contracts` does not import the
  engine; a future Zod schema for engine artifacts (if the AI layer ever needs to re-validate
  them) would be written in `contracts` against these types with `satisfies z.ZodType<...>`.
- Data enters only through `DataView`, built by `market-data` from its tables (reference data)
  and the user's intraday tier. The engine never knows which user or which provider it serves;
  tenant isolation stays entirely in `apps/web`.
- Replaceability: because every input and output is JSON, `compute` and `step` can be
  re-exported by a thin adapter that posts to a worker or a WASM module. Callers keep the
  signatures; only the adapter changes.

## 5. Trade-offs

Where leverage is high:

- Two functions cover charts, pricing, structure building, the nightly job, intraday catch-up,
  portfolio valuation, settlement proposals, scoring and backtests. Every caller learns one
  shape: build a view, ask, read a `Result`.
- `signals` with `since` unifies daily evaluation, intraday evaluation and catch-up; the
  backtest evaluator is the same interpreter, so hygiene tested once holds everywhere.
- `price` accepting `Leg[] | LegSelection` makes "build and price" one round trip and lets the
  portfolio and the backtester reuse `Valuation` unchanged.
- The `Result` envelope with `Meta` gives every artifact its citation, model disclosure and
  truncation report for free, which is exactly what ADR-0002, ADR-0009 and ADR-0011 require.
- The data protocol (strings and integers) removes `decimal.js` from every caller and makes the
  seam language-agnostic.

Where it is thin or awkward:

- The function count is a vanity metric: the real interface is the `Query` union and the view
  type. Six query kinds is the honest count, and adding a seventh is a shape change to the frozen
  ADR (mitigation: new kinds are additive and callers switch exhaustively, so the change is loud).
- Untyped-ness at the union boundary: `compute` needs a conditional return type; editor
  ergonomics are good, but error messages on a malformed query are worse than with six named
  functions.
- The view is caller-assembled, so the caller must know what to load; `requirements` exists
  only to close that gap and is the one query that is not a domain computation.
- Decimal strings mean parse-on-entry on every call; for `step` over long views this is measurable
  but bounded (the fix is an internal cache keyed by view identity, invisible to callers).
- A bag-of-facts view is truncated by the engine rather than made unrepresentable by type. The
  guarantee is behavioral and tested, not structural; a capability-style view would be structural
  but would leak engine internals to the caller and break the JSON-only rule.
- The opaque checkpoint pins the run to an engine version; a deploy mid-run restarts the run.
  Acceptable for a personal tool; noted so nobody treats it as a bug.
- Walk-forward here is stability reporting over windows of the same fixed strategy, not
  parameter optimization; the DSL has no parameter space to optimize yet (see question 2).
- YAGNI flags on my own proposal: `Requirements.needsChain` and `needsRiskFree` may be derivable
  by the view builder from the strategy alone; `Signal.outcome.kind === "none"` doubles output
  size in catch-up and could be dropped if the inbox is the only consumer.

## 6. Open questions for the owner

1. Thesis verdict at horizon: is "the thesis held" something the user confirms when the horizon
   passes, or must the thesis be written as a checkable condition (for example "PETR4 closes above
   40 by 2026-12-19") so the engine decides? The interface accepts both; the product must pick a
   default, since it changes how a decision is recorded.
2. Walk-forward: is v1 satisfied by comparing metrics across successive windows for the same
   strategy version, or do you want parameter optimization (which requires the strategy JSON to
   declare ranges, a DSL change)?
3. Expiry settlement proposals: should the engine propose exercise whenever an option is in the
   money at expiry close by any amount, or only above a threshold that covers exercise costs?
4. Intraday signals when the intraday tier is missing an option series (no live chain for that
   strike): record "no series match" silently in the inbox, or surface it as a visible warning?
5. Portfolio mark to market: when a series has no trade today, prefer the last available trade
   (stale, dated) or the model fair value (fresh, approximate)? The valuation can report both;
   the product must pick what the total shows.
