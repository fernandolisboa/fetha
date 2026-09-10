import Decimal from "decimal.js";
import type {
  Centavos,
  CostModel,
  DecimalString,
  ExitRule,
  Instant,
  SessionDate,
  Ticker,
} from "@fetha/contracts";
import {
  ENGINE_VERSION,
  pricingModels,
  type BacktestCheckpoint,
  type BacktestConfig,
  type BacktestProgress,
  type BacktestRun,
  type Candle,
  type DataWindow,
  type EquityPoint,
  type EvaluationOutcome,
  type Leg,
  type LimitBreach,
  type MissedEntry,
  type MissedEntryReason,
  type MonthlyTax,
  type Operation,
  type OperationLeg,
  type Result,
  type RunBacktestInput,
  type SessionLimitBreach,
  type SimulatedFill,
  type SimulatedOperation,
  type TradingSession,
} from "../api";
import { batchTruncationReport } from "./batch-truncation";
import { computeBacktestMetrics, sumCentavos, type MetricsInput } from "./backtest-metrics";
import { computeMonthlyTax } from "./backtest-taxes";
import { configDigest } from "./config-digest";
import { CENTAVOS_PER_REAL, parseDecimal, RATIO_SCALE, toDecimalString } from "./decimal";
import { dataWindow as computeDataWindow } from "./data-window";
import { evaluateStrategy } from "./evaluate-strategy";
import { isAtOrBefore } from "./instant";
import { assertDefined, invariant } from "./invariant";
import { codeUnitCompare, sortUnique } from "./order";
import { toCentavos, toQuantity } from "./scalars";
import { splitFactorProduct } from "./split-factor";

type PendingEntry = {
  legs: Leg[];
  maxLoss: Centavos | "unbounded";
  limitBreaches: LimitBreach[];
  signalSession: SessionDate;
};
type PendingExit = { operationId: string; rule: ExitRule };

type BacktestState = {
  cash: number;
  openOperations: Operation[];
  fills: SimulatedFill[];
  operations: SimulatedOperation[];
  missedEntries: MissedEntry[];
  limitBreaches: SessionLimitBreach[];
  equityCurve: EquityPoint[];
  held: boolean[];
  // Carried in the checkpoint state, not call-local: a resumed run must pair each equity
  // point with the risk-free rate visible at that same session's close, or a chunked run's
  // Sharpe (and walk-forward windows) diverge from an uninterrupted call over the same period.
  rfPerSession: DecimalString[];
  runningPeak: number;
  pendingEntries: Record<string, PendingEntry>;
  retryCount: Record<string, number>;
  pendingExits: Record<string, PendingExit>;
  entryCosts: Record<string, Centavos[]>;
  entryMaxLoss: Record<string, Centavos | "unbounded">;
  currentMonthKey: string | null;
  currentMonthStockSales: number;
  currentMonthStockGain: number;
  taxesFinalized: MonthlyTax[];
  pendingTaxDeduction: { monthKey: string; tax: number } | null;
  operationSeq: number;
  equityClampEngaged: boolean;
};

function initialState(initialCapital: Centavos): BacktestState {
  return {
    cash: initialCapital,
    openOperations: [],
    fills: [],
    operations: [],
    missedEntries: [],
    limitBreaches: [],
    equityCurve: [],
    held: [],
    rfPerSession: [],
    runningPeak: initialCapital,
    pendingEntries: {},
    retryCount: {},
    pendingExits: {},
    entryCosts: {},
    entryMaxLoss: {},
    currentMonthKey: null,
    currentMonthStockSales: 0,
    currentMonthStockGain: 0,
    taxesFinalized: [],
    pendingTaxDeduction: null,
    operationSeq: 0,
    equityClampEngaged: false,
  };
}

function invalidInput<T>(path: string, message: string): Result<T> {
  return { ok: false, error: { code: "invalid_input", path, message } };
}

function checkpointMismatch(
  expectedDigest: string,
  receivedDigest: string,
): Result<BacktestProgress> {
  return { ok: false, error: { code: "checkpoint_mismatch", expectedDigest, receivedDigest } };
}

function monthKeyOf(session: SessionDate): string {
  return session.slice(0, 7);
}

// `visibleAt` is the reading instant of the session this candle is used for — that same
// session's own close, matching a candle's own asOf convention (ADR-0013 "asOf is the candle
// close for candles"): a normal candle is always visible by its own session's close, but a
// candle restated later (asOf pushed past that close) must stay invisible to a fill or a mark
// computed at that close, per I1.
function candleFor(
  candlesByTicker: Map<Ticker, Candle[]>,
  ticker: Ticker,
  session: SessionDate,
  visibleAt: Instant,
): Candle | null {
  const candles = candlesByTicker.get(ticker) ?? [];
  return candles.find((c) => c.session === session && isAtOrBefore(c.asOf, visibleAt)) ?? null;
}

function lastKnownClose(
  candlesByTicker: Map<Ticker, Candle[]>,
  ticker: Ticker,
  uptoSession: SessionDate,
  visibleAt: Instant,
): DecimalString | null {
  const candles = (candlesByTicker.get(ticker) ?? []).filter(
    (c) => c.session <= uptoSession && isAtOrBefore(c.asOf, visibleAt),
  );
  // Both call sites only ask about a ticker that already has an open operation, which can only
  // exist because a fill found a candle for it on or before this same session in an
  // uninterrupted run — but a resumed run's view can legitimately lack that history if the
  // caller didn't carry it over, so both callers turn this into insufficient_data.
  if (candles.length === 0) return null;
  return assertDefined(
    candles.reduce((latest, c) => (c.session > latest.session ? c : latest)),
    "run-backtest: reduce over a non-empty array always yields a value",
  ).close;
}

// A resumed run's view must carry the same history as the run that produced its checkpoint
// (ADR-0013): if it doesn't, an open operation's underlying can be missing every candle a mark
// needs. That is a caller error, not an engine bug, so it is a typed insufficient_data result,
// never a thrown exception.
function missingMarkError<T>(
  ticker: Ticker,
  openedAt: SessionDate,
  sortedCalendar: readonly TradingSession[],
  through: Instant,
): Result<T> {
  const openedAtSession = sortedCalendar.find((s) => s.date === openedAt);
  // openedAt always names a session this same sortedCalendar carries (it was set from one of
  // its own sessions when the operation opened); the fallback only guards the type.
  /* v8 ignore next */
  const from = openedAtSession?.open ?? through;
  const needed: DataWindow = {
    from,
    to: through,
    instruments: [ticker],
    timeframes: ["D1"],
    collections: ["candles"],
  };
  return { ok: false, error: { code: "insufficient_data", needed } };
}

// The gross traded value of a fill or a mark, on the centavos scale but not yet rounded to an
// integer Centavos: callers that compose it further (fillCosts) or need the unrounded value for
// a sum keep it as a Decimal; callers that record it as money round it themselves.
function grossCentavos(price: DecimalString, quantity: number | Decimal): Decimal {
  return parseDecimal(price).mul(CENTAVOS_PER_REAL).mul(quantity);
}

function fillCosts(costModel: CostModel, price: DecimalString, quantity: number): Centavos {
  const gross = grossCentavos(price, quantity);
  const b3Fee = gross.mul(parseDecimal(costModel.b3FeeRate)).round().toNumber();
  return toCentavos(b3Fee + costModel.brokerage.stockPerOrder);
}

function operationId(
  seq: number,
  strategyVersionId: string,
  ticker: Ticker,
  session: SessionDate,
): string {
  return `${strategyVersionId}:${ticker}:${session}:${String(seq)}`;
}

// Exhaustive over EvaluationOutcome so a future outcome the type gains is a compile error here,
// not a silently wrong reason. no_series_match and degenerate_strikes are unreachable for a
// stock-only run (#16) — evaluateStrategy never selects strikes for a stock-only structure — but
// mapping them to their own MissedEntryReason keeps this scheduler correct if it is ever reused
// for a structure with option legs.
function missedEntryReasonFor(outcome: EvaluationOutcome | undefined): MissedEntryReason {
  if (outcome === "unsizeable") return "unsizeable";
  /* v8 ignore start */
  if (outcome === "no_series_match") return "no_series_match";
  if (outcome === "degenerate_strikes") return "degenerate_strikes";
  /* v8 ignore stop */
  // Every remaining EvaluationOutcome ("signal", "conditions_not_met", "insufficient_data") and
  // "undefined" (no matching evaluation record) fall back to "no_trades", the only
  // MissedEntryReason a fill-time failure with none of the above outcomes can be.
  return "no_trades";
}

function legPnlCentavos(
  leg: OperationLeg,
  exitPrice: DecimalString,
  splitFactor: Decimal,
): Decimal {
  const sign = leg.side === "buy" ? 1 : -1;
  const effectiveEntryPrice = parseDecimal(leg.entryPrice).mul(splitFactor);
  const effectiveQuantity = new Decimal(leg.quantity).div(splitFactor);
  return parseDecimal(exitPrice)
    .sub(effectiveEntryPrice)
    .mul(sign)
    .mul(CENTAVOS_PER_REAL)
    .mul(effectiveQuantity);
}

export function runBacktest(input: RunBacktestInput): Result<BacktestProgress> {
  const { config, view } = input;

  const hasOptionLegs = config.strategy.structure.legs.some((leg) => leg.role !== "stock");
  if (hasOptionLegs) {
    const firstStrike = assertDefined(
      config.strategy.definition.strikes[0],
      "runBacktest: coherence guarantees at least one strike selection for option legs",
    );
    return {
      ok: false,
      error: { code: "unsupported", vocabulary: "strikeSelections", kind: firstStrike.kind },
    };
  }
  if (config.strategy.definition.timeframe !== "D1") {
    return invalidInput(
      "config.strategy.definition.timeframe",
      "runBacktest is daily-only in v1 (#16); intraday backtesting needs option fair-value fills (#21)",
    );
  }

  if (input.maxSessions !== undefined && !Number.isInteger(input.maxSessions)) {
    return invalidInput("maxSessions", "maxSessions must be a positive integer");
  }
  if (input.maxSessions !== undefined && input.maxSessions <= 0) {
    return invalidInput("maxSessions", "maxSessions must be a positive integer");
  }
  if (
    config.walkForward !== null &&
    (!Number.isInteger(config.walkForward.windowSessions) || config.walkForward.windowSessions <= 0)
  ) {
    return invalidInput(
      "config.walkForward.windowSessions",
      "windowSessions must be a positive integer",
    );
  }

  const digest = configDigest(config);
  if (input.resume !== undefined) {
    // BacktestCheckpoint.schema is typed as the literal 1, but a caller round-tripping a
    // checkpoint through storage passes plain JSON at runtime, not a type-checked value, so this
    // still needs a real runtime check. The frozen EngineError shape for checkpoint_mismatch
    // (ADR-0013) carries only expectedDigest/receivedDigest, so each distinct cause is tagged
    // with its own field name inside those two strings rather than left to read as an
    // (incorrectly) failed digest comparison.
    const receivedSchema: number = input.resume.schema;
    if (receivedSchema !== 1) {
      return checkpointMismatch("schema:1", `schema:${String(receivedSchema)}`);
    }
    if (input.resume.engineVersion !== ENGINE_VERSION) {
      return checkpointMismatch(
        `engineVersion:${ENGINE_VERSION}`,
        `engineVersion:${input.resume.engineVersion}`,
      );
    }
    if (input.resume.configDigest !== digest) {
      return checkpointMismatch(digest, input.resume.configDigest);
    }
  }

  const calendarDupe = sortUnique(
    view.calendar,
    (s) => s.date,
    (a, b) => codeUnitCompare(a.date, b.date),
  );
  if (!calendarDupe.ok) {
    return invalidInput("view.calendar", `duplicate session ${calendarDupe.duplicateKey}`);
  }
  const sortedCalendar = calendarDupe.value;
  const periodSessions = sortedCalendar.filter(
    (s) => s.date >= config.period.from && s.date <= config.period.to,
  );
  if (periodSessions.length === 0) {
    return invalidInput("config.period", "no calendar session falls inside the requested period");
  }

  const candlesByTicker = new Map<Ticker, Candle[]>();
  for (const c of view.candles) {
    if (c.timeframe !== "D1") continue;
    const bucket = candlesByTicker.get(c.ticker);
    if (bucket) bucket.push(c);
    else candlesByTicker.set(c.ticker, [c]);
  }

  const corporateActionsByTicker = new Map<Ticker, typeof view.corporateActions>();
  for (const f of view.corporateActions) {
    const bucket = corporateActionsByTicker.get(f.ticker);
    if (bucket) bucket.push(f);
    else corporateActionsByTicker.set(f.ticker, [f]);
  }
  // `Operation.legs` themselves stay nominal — the evaluator already rebases its own exit-rule
  // comparisons the same way (ADR-0014 Q51) — so this is applied only where runBacktest computes
  // marks, fills and P&L on its own. `visibleAt` is the reading instant: every caller — an entry
  // fill, an exit fill, a mark or the period-end sweep — reads it against that same session's
  // close, the one reading instant Q51 settles on so no two of them can disagree over which
  // factors are visible yet (I1); a factor not yet visible there is excluded, matching
  // provenance.truncated for the same rows.
  function corporateActionFactorThrough(
    ticker: Ticker,
    openedAt: SessionDate,
    through: SessionDate,
    visibleAt: Instant,
  ): Decimal {
    const factors = (corporateActionsByTicker.get(ticker) ?? []).filter((f) =>
      isAtOrBefore(f.asOf, visibleAt),
    );
    return splitFactorProduct(factors, openedAt, through);
  }

  const cdiByAsOf = view.macro.filter((m) => m.series === "cdi");
  function rfAt(at: Instant): DecimalString {
    let latest: (typeof cdiByAsOf)[number] | null = null;
    for (const p of cdiByAsOf) {
      if (p.asOf > at) continue;
      if (latest === null || p.asOf > latest.asOf) latest = p;
    }
    if (!latest) return toDecimalString(new Decimal(0), RATIO_SCALE);
    return toDecimalString(
      new Decimal(1).add(parseDecimal(latest.annualRate)).pow(new Decimal(1).div(252)).sub(1),
      RATIO_SCALE,
    );
  }

  const startIndex =
    input.resume === undefined
      ? 0
      : periodSessions.findIndex((s) => s.date === input.resume?.cursor) + 1;
  if (input.resume !== undefined && startIndex === 0) {
    return invalidInput("resume.cursor", "the checkpoint cursor is not a session of this period");
  }

  const budget = input.maxSessions ?? periodSessions.length - startIndex;
  const endIndex = Math.min(periodSessions.length, startIndex + Math.max(0, budget));

  // A caller round-trips `state` through storage as plain JSON, so it can carry any shape at
  // runtime regardless of what BacktestCheckpoint['state'] says at compile time — a non-object,
  // or one missing an array equityCurve, must be a typed checkpoint_mismatch, never a thrown
  // TypeError from dereferencing a field that isn't there.
  if (input.resume !== undefined) {
    const rawState: unknown = input.resume.state;
    if (
      typeof rawState !== "object" ||
      rawState === null ||
      !Array.isArray((rawState as { equityCurve?: unknown }).equityCurve)
    ) {
      return checkpointMismatch("equityCurve.length:object", "equityCurve.length:not-an-object");
    }
  }

  const state: BacktestState =
    input.resume === undefined
      ? initialState(config.initialCapital)
      : (input.resume.state as BacktestState);

  // A digest and schema match only prove the checkpoint targets this same config; a state whose
  // own equity curve does not already cover every session up to (not including) the resume
  // cursor is corrupt or was produced against a different calendar slice, and would silently
  // re-derive metrics from the wrong starting point.
  if (input.resume !== undefined && state.equityCurve.length !== startIndex) {
    return checkpointMismatch(
      `equityCurve.length:${String(startIndex)}`,
      `equityCurve.length:${String(state.equityCurve.length)}`,
    );
  }

  function finalizeMissedEntry(ticker: Ticker, signalAt: Instant, reason: MissedEntryReason): void {
    state.missedEntries.push({
      ticker,
      signalAt,
      sessionsTried: state.retryCount[ticker] ?? 0,
      reason,
    });
    Reflect.deleteProperty(state.retryCount, ticker);
    Reflect.deleteProperty(state.pendingEntries, ticker);
  }

  function finalizeMonth(monthKey: string): void {
    const tax = computeMonthlyTax(
      monthKey,
      toCentavos(state.currentMonthStockSales),
      toCentavos(state.currentMonthStockGain),
      config.costModel,
    );
    state.taxesFinalized.push(tax);
    state.currentMonthStockSales = 0;
    state.currentMonthStockGain = 0;
  }

  // Step 1: resolve pending entry fills targeting this session's open. evaluateStrategy
  // computes openOperationCount once per call, so several tickers signalling entry in the
  // same session each see the same, stale count and none alone trips maxOpenOperations;
  // this running counter re-checks the limit against fills already made this same session.
  // Returns the tickers whose fill attempt failed this same session (no candle, or no volume).
  function resolvePendingEntryFills(session: TradingSession): Result<Set<Ticker>> {
    const failedEntryTickers = new Set<Ticker>();
    let openCountThisSession = state.openOperations.length;
    const maxOpenOperations = config.riskProfile.limits.maxOpenOperations;
    for (const [ticker, pending] of Object.entries(state.pendingEntries)) {
      const candle = candleFor(candlesByTicker, ticker, session.date, session.close);
      state.retryCount[ticker] = (state.retryCount[ticker] ?? 0) + 1;
      if (candle && candle.tradedQuantity > 0) {
        if (openCountThisSession + 1 > maxOpenOperations) {
          if (config.limits === "enforce") {
            finalizeMissedEntry(ticker, session.open, "limit_breach");
            continue;
          }
          state.limitBreaches.push({
            limit: "maxOpenOperations",
            value: toDecimalString(new Decimal(openCountThisSession + 1), RATIO_SCALE),
            allowed: toDecimalString(new Decimal(maxOpenOperations), RATIO_SCALE),
            session: session.date,
            ticker,
          });
        }
        openCountThisSession += 1;
        const id = operationId(state.operationSeq, config.strategy.id, ticker, session.date);
        state.operationSeq += 1;
        // A split whose exDate lands on or before this fill session, strictly after the
        // signal that sized these legs, changes the share count the signal-time sizing must
        // land on — the size was decided against the pre-split price, so the quantity itself
        // is rescaled the same way an existing open leg's quantity would be (ADR-0014 Q51),
        // read at this same session's close, the same reading instant every other fill, mark
        // and the sweep already use (I1): a factor stamped intraday must apply here exactly
        // when it would also apply to a same-session mark, never left invisible to this fill
        // alone because it reads a stale earlier instant.
        const entryFactor = corporateActionFactorThrough(
          ticker,
          pending.signalSession,
          session.date,
          session.close,
        );
        const rescaledQuantities: number[] = [];
        for (const leg of pending.legs) {
          const rescaled = entryFactor.eq(1)
            ? leg.quantity
            : Math.round(new Decimal(leg.quantity).div(entryFactor).toNumber());
          if (!Number.isSafeInteger(rescaled) || rescaled <= 0) {
            return invalidInput(
              "view.corporateActions",
              `split factor produces a non-integer-safe entry quantity for ${ticker}`,
            );
          }
          rescaledQuantities.push(rescaled);
        }
        const legs: OperationLeg[] = pending.legs.map((leg, legIndex) => ({
          role: leg.role,
          side: leg.side,
          ticker: leg.ticker,
          quantity: toQuantity(
            assertDefined(
              rescaledQuantities[legIndex],
              "run-backtest: rescaledQuantities has one entry per leg",
            ),
          ),
          entryPrice: candle.open,
        }));
        const entryCosts: Centavos[] = [];
        for (const leg of legs) {
          const costs = fillCosts(config.costModel, candle.open, leg.quantity);
          entryCosts.push(costs);
          const gross = grossCentavos(candle.open, leg.quantity).round().toNumber();
          state.cash -= (leg.side === "buy" ? 1 : -1) * gross + costs;
          // A short entry is itself a stock sell (ADR-0004's exemption reads "stock
          // sells in the month", any sell fill, not only an exit closing a long): the
          // exit-fill loop below only sees the covering buy for this leg, so it never
          // counts, and this is the only place that can.
          if (leg.side === "sell") {
            state.currentMonthStockSales += gross;
          }
          state.fills.push({
            ticker,
            side: leg.side,
            quantity: leg.quantity,
            price: candle.open,
            session: session.date,
            at: session.open,
            costs,
            operationId: id,
            source: "next_session_open",
          });
        }
        state.openOperations.push({
          id,
          underlying: ticker,
          legs,
          expiry: null,
          openedAt: session.date,
          strategyVersionId: config.strategy.id,
          rolledFrom: null,
        });
        state.entryCosts[id] = entryCosts;
        state.entryMaxLoss[id] = pending.maxLoss;
        // maxOpenOperations is re-checked, and recorded, at fill time just above against the
        // running same-session counter (the authoritative count); the signal-time breach
        // evaluateStrategy recorded for the same limit is the same finding under a stale count,
        // so it is dropped here to avoid recording it twice.
        for (const breach of pending.limitBreaches) {
          if (breach.limit === "maxOpenOperations") continue;
          state.limitBreaches.push({ ...breach, session: session.date, ticker });
        }
        Reflect.deleteProperty(state.pendingEntries, ticker);
        state.retryCount[ticker] = 0;
      } else {
        failedEntryTickers.add(ticker);
        Reflect.deleteProperty(state.pendingEntries, ticker);
      }
    }
    return { ok: true, value: failedEntryTickers };
  }

  // Step 1b: resolve pending exit fills targeting this session's open (retried indefinitely).
  function resolvePendingExitFills(session: TradingSession): Result<void> {
    for (const [opId] of Object.entries(state.pendingExits)) {
      const opIndex = state.openOperations.findIndex((op) => op.id === opId);
      invariant(
        opIndex !== -1,
        "run-backtest: a pending exit always references a currently open operation",
      );
      const op = assertDefined(state.openOperations[opIndex], "run-backtest: opIndex is valid");
      const candle = candleFor(candlesByTicker, op.underlying, session.date, session.close);
      if (!candle || candle.tradedQuantity <= 0) continue;

      const entryCosts = state.entryCosts[op.id] ?? op.legs.map(() => toCentavos(0));
      // Read at this same session's close, the instant `candleFor` above already used to decide
      // this candle is visible: a factor whose own asOf sits between this session's open and
      // close must apply to this fill exactly when it would also apply to a same-session mark of
      // an operation that stayed open instead of exiting (I1), never on some other instant that
      // could disagree over which factors are visible yet.
      const splitFactor = corporateActionFactorThrough(
        op.underlying,
        op.openedAt,
        session.date,
        session.close,
      );
      let pnl = new Decimal(0);
      for (let legIndex = 0; legIndex < op.legs.length; legIndex += 1) {
        const leg = assertDefined(op.legs[legIndex], "run-backtest: legIndex within bounds");
        const exitSide: "buy" | "sell" = leg.side === "buy" ? "sell" : "buy";
        // The exit trades an integer number of shares; a grouping factor that does not divide
        // `leg.quantity` evenly leaves a sub-one-share residue, cash-settled at this same fill's
        // price rather than dropped or rounded into a share that was never granted (ADR-0014
        // Q51). `pnl` is computed once, below, from the full unrounded effective quantity, so it
        // already accounts for both the traded shares and the residue.
        const rawEffectiveQuantity = new Decimal(leg.quantity).div(splitFactor);
        const effectiveShares = Math.floor(rawEffectiveQuantity.toNumber());
        // An adversarial or corrupt factor (near-zero, e.g. 1e-15) blows this count up past what
        // a real share count can be; that is invalid input, not a value toQuantity should throw
        // an invariant over.
        if (effectiveShares > 0 && !Number.isSafeInteger(effectiveShares)) {
          return invalidInput(
            "view.corporateActions",
            `split factor produces a non-integer-safe effective share count for ${op.underlying}`,
          );
        }
        const residue = rawEffectiveQuantity.sub(effectiveShares);
        let costs = toCentavos(0);
        if (effectiveShares > 0) {
          const q = toQuantity(effectiveShares);
          costs = fillCosts(config.costModel, candle.open, q);
          const gross = grossCentavos(candle.open, q).round().toNumber();
          state.cash += (exitSide === "sell" ? 1 : -1) * gross - costs;
          state.fills.push({
            ticker: op.underlying,
            side: exitSide,
            quantity: q,
            price: candle.open,
            session: session.date,
            at: session.open,
            costs,
            operationId: op.id,
            source: "next_session_open",
          });
          if (exitSide === "sell") state.currentMonthStockSales += gross;
        }
        if (residue.isPositive()) {
          const residueGross = grossCentavos(candle.open, residue).round().toNumber();
          state.cash += (exitSide === "sell" ? 1 : -1) * residueGross;
          if (exitSide === "sell") state.currentMonthStockSales += residueGross;
        }
        const entryCost = entryCosts[legIndex] ?? toCentavos(0);
        pnl = pnl
          .add(legPnlCentavos(leg, candle.open, splitFactor))
          .sub(costs)
          .sub(entryCost);
      }
      const pnlCentavos = toCentavos(pnl.round().toNumber());
      state.currentMonthStockGain += pnlCentavos;
      const pendingExit = assertDefined(
        state.pendingExits[opId],
        "run-backtest: opId is a key of pendingExits in this loop",
      );
      state.operations.push({
        id: op.id,
        underlying: op.underlying,
        legs: op.legs,
        expiry: null,
        openedAt: op.openedAt,
        strategyVersionId: op.strategyVersionId,
        rolledFrom: op.rolledFrom,
        pnl: pnlCentavos,
        maxLoss: state.entryMaxLoss[op.id] ?? toCentavos(0),
        status: "closed",
        closedAt: session.date,
        closeReason: { kind: "exit_rule", rule: pendingExit.rule },
      });
      state.openOperations.splice(opIndex, 1);
      Reflect.deleteProperty(state.pendingExits, opId);
      Reflect.deleteProperty(state.entryCosts, op.id);
      Reflect.deleteProperty(state.entryMaxLoss, op.id);
    }
    return { ok: true, value: undefined };
  }

  // Step 2: tax deduction. A month's own tax, computed the day its last session was seen, is
  // deducted on the next session (or, for the run's very last month, on that same last session).
  function deductPendingTax(monthKey: string, isFinalSession: boolean, i: number): void {
    if (
      state.pendingTaxDeduction !== null &&
      state.pendingTaxDeduction.monthKey === monthKey &&
      isLastSessionOfMonth(periodSessions, i, monthKey)
    ) {
      state.cash -= state.pendingTaxDeduction.tax;
      state.pendingTaxDeduction = null;
    }
    if (isFinalSession) {
      // The final session is always the last session of its own month as far as this run is
      // concerned (there is no later session to prove otherwise), so the deduction above already
      // paid off a pending deduction whose target month matches this one; nothing can be left
      // over here except the current, not-yet-finalized month. `monthKey` (this session's own
      // month) is state.currentMonthKey's value at this point — read as a parameter, not off
      // `state`, since a plain object property does not carry the caller's null-check narrowing
      // across a function boundary.
      finalizeMonth(monthKey);
      const finalTax = assertDefined(state.taxesFinalized.at(-1), "run-backtest: finalized above");
      state.cash -= finalTax.tax;
    }
  }

  // Step 3: equity for this session. Marks are kept (per ticker) for the period-end sweep to
  // reuse: it processes the same state.openOperations at the same session.date, so a second
  // lookup would always find exactly what this one already did.
  function markOpenOperations(
    session: TradingSession,
  ): Result<{ equity: Centavos; marksThisSession: Map<Ticker, DecimalString> }> {
    let markValue = 0;
    const marksThisSession = new Map<Ticker, DecimalString>();
    for (const op of state.openOperations) {
      const markPriceOrNull = lastKnownClose(
        candlesByTicker,
        op.underlying,
        session.date,
        session.close,
      );
      if (markPriceOrNull === null) {
        return missingMarkError(op.underlying, op.openedAt, sortedCalendar, session.close);
      }
      const markPrice = markPriceOrNull;
      marksThisSession.set(op.underlying, markPrice);
      const splitFactor = corporateActionFactorThrough(
        op.underlying,
        op.openedAt,
        session.date,
        session.close,
      );
      for (const leg of op.legs) {
        const sign = leg.side === "buy" ? 1 : -1;
        const effectiveQuantity = new Decimal(leg.quantity).div(splitFactor);
        markValue += sign * grossCentavos(markPrice, effectiveQuantity).round().toNumber();
      }
    }
    const equity = toCentavos(state.cash + markValue);
    state.runningPeak = Math.max(state.runningPeak, equity);
    const drawdown =
      state.runningPeak <= 0
        ? toDecimalString(new Decimal(0), RATIO_SCALE)
        : toDecimalString(
            new Decimal(1).sub(new Decimal(equity).div(state.runningPeak)),
            RATIO_SCALE,
          );
    state.equityCurve.push({
      session: session.date,
      equity,
      cash: toCentavos(state.cash),
      drawdown,
    });
    state.held.push(state.openOperations.length > 0);
    state.rfPerSession.push(rfAt(session.close));
    return { ok: true, value: { equity, marksThisSession } };
  }

  // Step 4/5: period end sweep (closes every still-open operation at its own mark, finalizes
  // stranded pending entries, and signals the caller to stop this session's processing), or,
  // on every other session, evaluates the strategy for the next signals and queues them.
  function sweepOrQueueNextSignals(
    session: TradingSession,
    isFinalSession: boolean,
    equity: Centavos,
    marksThisSession: Map<Ticker, DecimalString>,
    failedEntryTickers: Set<Ticker>,
  ): Result<"continue" | "proceed"> {
    if (isFinalSession) {
      for (const op of state.openOperations) {
        const price = assertDefined(
          marksThisSession.get(op.underlying),
          "run-backtest: markOpenOperations already marked every currently open operation this same session",
        );
        const entryCosts = state.entryCosts[op.id] ?? op.legs.map(() => toCentavos(0));
        const splitFactor = corporateActionFactorThrough(
          op.underlying,
          op.openedAt,
          session.date,
          session.close,
        );
        let pnl = new Decimal(0);
        op.legs.forEach((leg, legIndex) => {
          const entryCost = entryCosts[legIndex] ?? toCentavos(0);
          pnl = pnl.add(legPnlCentavos(leg, price, splitFactor)).sub(entryCost);
        });
        state.operations.push({
          id: op.id,
          underlying: op.underlying,
          legs: op.legs,
          expiry: null,
          openedAt: op.openedAt,
          strategyVersionId: op.strategyVersionId,
          rolledFrom: op.rolledFrom,
          pnl: toCentavos(pnl.round().toNumber()),
          maxLoss: state.entryMaxLoss[op.id] ?? toCentavos(0),
          status: "closed",
          closedAt: session.date,
          closeReason: { kind: "period_end" },
        });
        Reflect.deleteProperty(state.entryCosts, op.id);
        Reflect.deleteProperty(state.entryMaxLoss, op.id);
      }
      state.openOperations = [];
      const strandedEntryTickers = new Set<Ticker>([
        ...Object.keys(state.pendingEntries),
        ...failedEntryTickers,
      ]);
      for (const ticker of strandedEntryTickers) {
        finalizeMissedEntry(ticker, session.close, "no_trades");
      }
      state.pendingExits = {};
      return { ok: true, value: "continue" };
    }

    if (equity <= 0) state.equityClampEngaged = true;
    const currentEquity = Math.max(equity, 1);
    const effectiveStrategy = {
      ...config.strategy,
      definition: {
        ...config.strategy.definition,
        sizing: config.sizing ?? config.strategy.definition.sizing,
      },
    };
    const evalResult = evaluateStrategy({
      view,
      strategy: effectiveStrategy,
      instruments: config.universe,
      at: session.close,
      openOperations: state.openOperations,
      riskProfile: {
        declaredCapital: toCentavos(currentEquity),
        limits: config.riskProfile.limits,
      },
    });
    if (!evalResult.ok) return { ok: false, error: evalResult.error };

    const seenTickersThisRound = new Set<Ticker>();
    for (const signal of evalResult.value.signals) {
      if (signal.kind === "entry") {
        seenTickersThisRound.add(signal.ticker);
        const breached = signal.proposal.pricing.limitBreaches.length > 0;
        if (breached && config.limits === "enforce") {
          finalizeMissedEntry(signal.ticker, signal.at, "limit_breach");
          continue;
        }
        if (failedEntryTickers.has(signal.ticker) && (state.retryCount[signal.ticker] ?? 0) >= 3) {
          finalizeMissedEntry(signal.ticker, signal.at, "no_trades");
          continue;
        }
        state.pendingEntries[signal.ticker] = {
          legs: signal.proposal.legs,
          maxLoss: signal.proposal.pricing.maxLoss,
          limitBreaches: signal.proposal.pricing.limitBreaches,
          signalSession: session.date,
        };
      } else if (signal.kind === "exit") {
        if (!(signal.operationId in state.pendingExits)) {
          state.pendingExits[signal.operationId] = {
            operationId: signal.operationId,
            rule: signal.rule,
          };
        }
      }
    }

    for (const ticker of failedEntryTickers) {
      if (seenTickersThisRound.has(ticker)) continue;
      const record = evalResult.value.evaluations.find(
        (e) => e.ticker === ticker && e.at === session.close,
      );
      finalizeMissedEntry(ticker, session.close, missedEntryReasonFor(record?.outcome));
    }
    return { ok: true, value: "proceed" };
  }

  for (let i = startIndex; i < endIndex; i += 1) {
    const session = assertDefined(periodSessions[i], "run-backtest: index within bounds");
    const monthKey = monthKeyOf(session.date);
    // The last session inside the period, not the session that happens to fall on
    // config.period.to itself: a period.to on a non-trading day (a holiday or a
    // weekend) would otherwise leave the final session's sweep and tax finalization
    // never run.
    const isFinalSession = i === periodSessions.length - 1;

    if (state.currentMonthKey === null) {
      state.currentMonthKey = monthKey;
    } else if (monthKey !== state.currentMonthKey) {
      // deductPendingTax already pays off any pendingTaxDeduction whose target month is the
      // one that just finished, on that month's own last session in periodSessions —
      // whichever session follows it, gap or not — so by the time a new month is seen here
      // there is never one left in flight to overwrite.
      invariant(
        state.pendingTaxDeduction === null,
        "run-backtest: a month transition never finds a still-pending tax deduction",
      );
      const finishedMonth = state.currentMonthKey;
      finalizeMonth(finishedMonth);
      const tax = assertDefined(
        state.taxesFinalized.at(-1),
        "run-backtest: finalizeMonth always pushes one entry",
      );
      state.pendingTaxDeduction = { monthKey, tax: tax.tax };
      state.currentMonthKey = monthKey;
    }

    const entryFillsResult = resolvePendingEntryFills(session);
    if (!entryFillsResult.ok) return { ok: false, error: entryFillsResult.error };
    const failedEntryTickers = entryFillsResult.value;
    const exitFillsResult = resolvePendingExitFills(session);
    if (!exitFillsResult.ok) return { ok: false, error: exitFillsResult.error };
    deductPendingTax(monthKey, isFinalSession, i);

    const marked = markOpenOperations(session);
    if (!marked.ok) return { ok: false, error: marked.error };
    const { equity, marksThisSession } = marked.value;

    const next = sweepOrQueueNextSignals(
      session,
      isFinalSession,
      equity,
      marksThisSession,
      failedEntryTickers,
    );
    if (!next.ok) return { ok: false, error: next.error };
    if (next.value === "continue") continue;
  }

  const cursorSession = assertDefined(
    periodSessions[endIndex - 1],
    "run-backtest: at least one session is always processed",
  );

  if (endIndex < periodSessions.length) {
    const next = computeDataWindow({
      strategy: config.strategy,
      instruments: config.universe,
      calendar: view.calendar,
      at: assertDefined(periodSessions.at(-1), "run-backtest: non-empty period").close,
      since: cursorSession.close,
    });
    const checkpoint: BacktestCheckpoint = {
      schema: 1,
      engineVersion: ENGINE_VERSION,
      configDigest: digest,
      cursor: cursorSession.date,
      state,
    };
    return {
      ok: true,
      value: {
        status: "paused",
        checkpoint,
        sessionsDone: endIndex,
        sessionsTotal: periodSessions.length,
        next,
      },
    };
  }

  const { metrics, notes: metricsNotes } = computeBacktestMetrics(
    buildMetricsInput(state, config.initialCapital),
  );
  const notes = [...metricsNotes];
  if (state.equityCurve.some((p) => p.cash < 0)) {
    notes.push({
      code: "negative_cash",
      message: "cash went below zero during the run; v1 has no cash constraint",
    });
  }
  if (state.limitBreaches.length > 0) {
    notes.push({
      code: "limit_breach_warned",
      message: "the run filled at least one entry that breached the risk profile under warn mode",
    });
  }
  if (state.equityClampEngaged) {
    notes.push({
      code: "non_positive_equity",
      message:
        "equity was non-positive at least once during the run and was clamped to a positive sizing budget",
    });
  }

  const truncated = batchTruncationReport({
    candles: view.candles,
    corporateActions: view.corporateActions,
    impliedVolatilityIndex: view.impliedVolatilityIndex,
    macro: view.macro,
    dividendYields: view.dividendYields,
    instruments: config.universe,
    at: assertDefined(periodSessions.at(-1), "run-backtest: non-empty period").close,
    needsIv: false,
  });
  const run: BacktestRun = {
    config,
    configDigest: digest,
    operations: state.operations,
    fills: state.fills,
    missedEntries: state.missedEntries,
    limitBreaches: state.limitBreaches,
    equityCurve: state.equityCurve,
    metrics,
    walkForward: config.walkForward ? computeWalkForward(state, config, periodSessions) : null,
    taxes: state.taxesFinalized,
    notes,
    provenance: {
      engineVersion: ENGINE_VERSION,
      pricingModel: assertDefined(pricingModels[0], "run-backtest: pricingModels is non-empty"),
      truncated,
      dataVersion: view.dataVersion ?? null,
      datasetNotes: view.datasetNotes ?? [],
    },
  };

  return { ok: true, value: { status: "complete", run } };
}

function isLastSessionOfMonth(
  sessions: readonly TradingSession[],
  index: number,
  monthKey: string,
): boolean {
  const next = sessions[index + 1];
  return next === undefined || monthKeyOf(next.date) !== monthKey;
}

// A settled operation is one whose pnl is a result, not a mark: closed by an exit rule or a
// roll, or expired, but not closed by period_end (that pnl is a valuation, ADR-0013 "Equity and
// metrics"). winRate and profitFactor are computed over settled operations only. "expired" is
// unreachable for a stock-only run (#16, no option legs to settle) but handled correctly should
// this scheduler ever process a structure with option legs.
function isSettledOperation(op: SimulatedOperation): boolean {
  /* v8 ignore next */
  if (op.status !== "closed") return true;
  return op.closeReason.kind !== "period_end";
}

function buildMetricsInput(state: BacktestState, initialCapital: Centavos): MetricsInput {
  const settled = state.operations.filter(isSettledOperation);
  return {
    equityCurve: state.equityCurve,
    initialCapital,
    rfPerSession: state.rfPerSession,
    held: state.held,
    settledOperationPnls: settled.map((op) => op.pnl),
    operationsCount: state.operations.length,
    fees: sumCentavos(state.fills.map((f) => f.costs)),
    taxes: sumCentavos(state.taxesFinalized.map((t) => t.tax)),
    slippage: toCentavos(0),
  };
}

function computeWalkForward(
  state: BacktestState,
  config: BacktestConfig,
  periodSessions: readonly TradingSession[],
): NonNullable<BacktestRun["walkForward"]> {
  /* v8 ignore start */
  if (config.walkForward === null) {
    throw new Error("run-backtest: computeWalkForward only called when walkForward is configured");
  }
  /* v8 ignore stop */
  const windowSessions = config.walkForward.windowSessions;
  const windows: NonNullable<BacktestRun["walkForward"]> = [];
  for (let start = 0; start < periodSessions.length; start += windowSessions) {
    const end = Math.min(periodSessions.length, start + windowSessions);
    const windowSessionsSlice = periodSessions.slice(start, end);
    const from = assertDefined(windowSessionsSlice[0], "run-backtest: non-empty window").date;
    const to = assertDefined(windowSessionsSlice.at(-1), "run-backtest: non-empty window").date;
    const equitySlice = state.equityCurve.slice(start, end);
    const heldSlice = state.held.slice(start, end);
    const rfSlice = state.rfPerSession.slice(start, end);
    const baseline =
      start === 0
        ? config.initialCapital
        : assertDefined(
            state.equityCurve[start - 1],
            "run-backtest: a completed run has one equity point per processed session",
          ).equity;
    const opsInWindow = state.operations.filter((op) => op.openedAt >= from && op.openedAt <= to);
    const settled = opsInWindow.filter(isSettledOperation);
    const { metrics } = computeBacktestMetrics({
      equityCurve: equitySlice,
      initialCapital: baseline,
      rfPerSession: rfSlice,
      held: heldSlice,
      settledOperationPnls: settled.map((op) => op.pnl),
      operationsCount: opsInWindow.length,
      fees: sumCentavos(
        state.fills.filter((f) => f.session >= from && f.session <= to).map((f) => f.costs),
      ),
      taxes: sumCentavos(
        state.taxesFinalized
          .filter((t) => t.month >= from.slice(0, 7) && t.month <= to.slice(0, 7))
          .map((t) => t.tax),
      ),
      slippage: toCentavos(0),
    });
    windows.push({ from, to, metrics });
  }
  return windows;
}
