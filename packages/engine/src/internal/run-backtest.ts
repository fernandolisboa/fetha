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
  type BacktestCheckpoint,
  type BacktestConfig,
  type BacktestProgress,
  type BacktestRun,
  type Candle,
  type EquityPoint,
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
import { assertDefined, assertPresent, invariant } from "./invariant";
import { codeUnitCompare } from "./order";
import { toCentavos, toQuantity } from "./scalars";

type PendingEntry = {
  legs: Leg[];
  maxLoss: Centavos | "unbounded";
  limitBreaches: LimitBreach[];
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
  };
}

function invalidInput(path: string, message: string): Result<BacktestProgress> {
  return { ok: false, error: { code: "invalid_input", path, message } };
}

function monthKeyOf(session: SessionDate): string {
  return session.slice(0, 7);
}

function candleFor(
  candlesByTicker: Map<Ticker, Candle[]>,
  ticker: Ticker,
  session: SessionDate,
): Candle | null {
  const candles = candlesByTicker.get(ticker) ?? [];
  return candles.find((c) => c.session === session) ?? null;
}

function lastKnownClose(
  candlesByTicker: Map<Ticker, Candle[]>,
  ticker: Ticker,
  uptoSession: SessionDate,
): DecimalString | null {
  const candles = (candlesByTicker.get(ticker) ?? []).filter((c) => c.session <= uptoSession);
  // Both call sites only ask about a ticker that already has an open operation, which can only
  // exist because a fill found a candle for it on or before this same session — so `null` cannot
  // happen in practice, but the type stays honest about the general case.
  /* v8 ignore next */
  if (candles.length === 0) return null;
  return assertDefined(
    candles.reduce((latest, c) => (c.session > latest.session ? c : latest)),
    "run-backtest: reduce over a non-empty array always yields a value",
  ).close;
}

function fillCosts(costModel: CostModel, price: DecimalString, quantity: number): Centavos {
  const gross = parseDecimal(price).mul(CENTAVOS_PER_REAL).mul(quantity);
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
    if (input.resume.configDigest !== digest || input.resume.engineVersion !== ENGINE_VERSION) {
      return {
        ok: false,
        error: {
          code: "checkpoint_mismatch",
          expectedDigest: digest,
          receivedDigest: input.resume.configDigest,
        },
      };
    }
  }

  const sortedCalendar = [...view.calendar].sort((a, b) => codeUnitCompare(a.date, b.date));
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
  // The product of every visible split/reverse-split factor between an operation's own entry
  // and a later session (exclusive of the entry, inclusive of `through`): the multiplier that
  // turns the nominal share count and entry price recorded at entry into the effective count and
  // price comparable with `through`'s own nominal candles (ADR-0013 "Candles and corporate
  // actions"). `Operation.legs` themselves stay nominal — the evaluator already rebases its own
  // exit-rule comparisons the same way — so this is applied only where runBacktest computes
  // marks, fills and P&L on its own.
  function corporateActionFactorThrough(
    ticker: Ticker,
    openedAt: SessionDate,
    through: SessionDate,
  ): Decimal {
    const factors = corporateActionsByTicker.get(ticker) ?? [];
    return factors.reduce((acc, f) => {
      if (f.exDate > openedAt && f.exDate <= through) return acc.mul(parseDecimal(f.factor));
      return acc;
    }, new Decimal(1));
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

  const state: BacktestState =
    input.resume === undefined
      ? initialState(config.initialCapital)
      : (input.resume.state as BacktestState);

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
    return;
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
      // A calendar gap (a month with no session at all in this run — never the case for a real
      // ANBIMA calendar, which trades every month, so untestable without a synthetic gap) would
      // otherwise let an unpaid deduction survive a second overwrite below and never reach cash;
      // flushing any leftover here keeps exactly one pending deduction in flight at a time.
      /* v8 ignore start */
      if (state.pendingTaxDeduction !== null) {
        state.cash -= state.pendingTaxDeduction.tax;
        state.pendingTaxDeduction = null;
      }
      /* v8 ignore stop */
      const finishedMonth = state.currentMonthKey;
      finalizeMonth(finishedMonth);
      const tax = assertDefined(
        state.taxesFinalized.at(-1),
        "run-backtest: finalizeMonth always pushes one entry",
      );
      state.pendingTaxDeduction = { monthKey, tax: tax.tax };
      state.currentMonthKey = monthKey;
    }

    // Step 1: resolve pending entry fills targeting this session's open. evaluateStrategy
    // computes openOperationCount once per call, so several tickers signalling entry in the
    // same session each see the same, stale count and none alone trips maxOpenOperations;
    // this running counter re-checks the limit against fills already made this same session.
    const failedEntryTickers = new Set<Ticker>();
    let openCountThisSession = state.openOperations.length;
    const maxOpenOperations = config.riskProfile.limits.maxOpenOperations;
    for (const [ticker, pending] of Object.entries(state.pendingEntries)) {
      const candle = candleFor(candlesByTicker, ticker, session.date);
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
        const legs: OperationLeg[] = pending.legs.map((leg) => ({
          role: leg.role,
          side: leg.side,
          ticker: leg.ticker,
          quantity: leg.quantity,
          entryPrice: candle.open,
        }));
        const entryCosts: Centavos[] = [];
        for (const leg of legs) {
          const costs = fillCosts(config.costModel, candle.open, leg.quantity);
          entryCosts.push(costs);
          const gross = parseDecimal(candle.open)
            .mul(CENTAVOS_PER_REAL)
            .mul(leg.quantity)
            .round()
            .toNumber();
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
        for (const breach of pending.limitBreaches) {
          state.limitBreaches.push({ ...breach, session: session.date, ticker });
        }
        Reflect.deleteProperty(state.pendingEntries, ticker);
        state.retryCount[ticker] = 0;
      } else {
        failedEntryTickers.add(ticker);
        Reflect.deleteProperty(state.pendingEntries, ticker);
      }
    }

    // Step 1b: resolve pending exit fills targeting this session's open (retried indefinitely).
    for (const [opId] of Object.entries(state.pendingExits)) {
      const opIndex = state.openOperations.findIndex((op) => op.id === opId);
      invariant(
        opIndex !== -1,
        "run-backtest: a pending exit always references a currently open operation",
      );
      const op = assertDefined(state.openOperations[opIndex], "run-backtest: opIndex is valid");
      const candle = candleFor(candlesByTicker, op.underlying, session.date);
      if (!candle || candle.tradedQuantity <= 0) continue;

      const entryCosts = state.entryCosts[op.id] ?? op.legs.map(() => toCentavos(0));
      const splitFactor = corporateActionFactorThrough(op.underlying, op.openedAt, session.date);
      let pnl = new Decimal(0);
      op.legs.forEach((leg, legIndex) => {
        const effectiveQuantity = toQuantity(
          new Decimal(leg.quantity).div(splitFactor).round().toNumber(),
        );
        const costs = fillCosts(config.costModel, candle.open, effectiveQuantity);
        const exitSide: "buy" | "sell" = leg.side === "buy" ? "sell" : "buy";
        const grossCentavos = parseDecimal(candle.open)
          .mul(CENTAVOS_PER_REAL)
          .mul(effectiveQuantity)
          .round()
          .toNumber();
        state.cash += (exitSide === "sell" ? 1 : -1) * grossCentavos - costs;
        state.fills.push({
          ticker: op.underlying,
          side: exitSide,
          quantity: effectiveQuantity,
          price: candle.open,
          session: session.date,
          at: session.open,
          costs,
          operationId: op.id,
          source: "next_session_open",
        });
        const entryCost = entryCosts[legIndex] ?? toCentavos(0);
        pnl = pnl
          .add(legPnlCentavos(leg, candle.open, splitFactor))
          .sub(costs)
          .sub(entryCost);
        if (exitSide === "sell") {
          state.currentMonthStockSales += grossCentavos;
        }
      });
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

    // Step 2: tax deduction.
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
      // concerned (there is no later session to prove otherwise), so step 2 above already paid
      // off a pending deduction whose target month matches this one; nothing can be left over
      // here except the current, not-yet-finalized month.
      finalizeMonth(state.currentMonthKey);
      const finalTax = assertDefined(state.taxesFinalized.at(-1), "run-backtest: finalized above");
      state.cash -= finalTax.tax;
    }

    // Step 3: equity for this session.
    let markValue = 0;
    for (const op of state.openOperations) {
      const markPrice = assertPresent(
        lastKnownClose(candlesByTicker, op.underlying, session.date),
        "run-backtest: an open operation's underlying always has a candle from its own entry fill",
      );
      const splitFactor = corporateActionFactorThrough(op.underlying, op.openedAt, session.date);
      for (const leg of op.legs) {
        const sign = leg.side === "buy" ? 1 : -1;
        const effectiveQuantity = new Decimal(leg.quantity).div(splitFactor);
        markValue +=
          sign *
          parseDecimal(markPrice).mul(CENTAVOS_PER_REAL).mul(effectiveQuantity).round().toNumber();
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

    // Step 4/5: period end sweep, or next signals.
    if (isFinalSession) {
      for (const op of state.openOperations) {
        const price = assertPresent(
          lastKnownClose(candlesByTicker, op.underlying, session.date),
          "run-backtest: an open operation's underlying always has a candle from its own entry fill",
        );
        const entryCosts = state.entryCosts[op.id] ?? op.legs.map(() => toCentavos(0));
        const splitFactor = corporateActionFactorThrough(op.underlying, op.openedAt, session.date);
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
      continue;
    }

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
      const reason: MissedEntryReason =
        record?.outcome === "unsizeable" ? "unsizeable" : "no_trades";
      finalizeMissedEntry(ticker, session.close, reason);
    }
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
    notes: metricsNotes,
    provenance: {
      engineVersion: ENGINE_VERSION,
      pricingModel: "bsm_continuous_yield",
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

function buildMetricsInput(state: BacktestState, initialCapital: Centavos): MetricsInput {
  const settled = state.operations.filter(
    (op) => op.status === "closed" && op.closeReason.kind !== "period_end",
  );
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
  if (config.walkForward === null) {
    throw new Error("run-backtest: computeWalkForward only called when walkForward is configured");
  }
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
    const settled = opsInWindow.filter(
      (op) => op.status === "closed" && op.closeReason.kind !== "period_end",
    );
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
