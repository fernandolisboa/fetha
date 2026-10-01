import Decimal from "decimal.js";
import type {
  Centavos,
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
  type BacktestProgress,
  type BacktestRun,
  type Candle,
  type DataWindow,
  type EquityPoint,
  type EvaluationOutcome,
  type Fill,
  type Leg,
  type LegSettlement,
  type LimitBreach,
  type MissedEntry,
  type MissedEntryReason,
  type MonthlyTax,
  type Note,
  type Operation,
  type OperationLeg,
  type OptionDayPrice,
  type Result,
  type RunBacktestInput,
  type SessionLimitBreach,
  type Side,
  type SimulatedFill,
  type SimulatedOperation,
  type TradingSession,
} from "../api";
import { batchTruncationReport } from "./batch-truncation";
import {
  computeBacktestMetrics,
  isSettledOperation,
  sumCentavos,
  type MetricsInput,
} from "./backtest-metrics";
import { computeMonthlyTax } from "./backtest-taxes";
import { configDigest } from "./config-digest";
import {
  CENTAVOS_PER_REAL,
  parseDecimal,
  PRICE_SCALE,
  RATIO_SCALE,
  toDecimalString,
  toDecimalStringAtLeastScale,
} from "./decimal";
import { dataWindow as computeDataWindow } from "./data-window";
import { createStrategyEvaluator } from "./evaluate-strategy";
import { indexBySession, lastKnownRow, rowOnSession, type SessionRows } from "./session-rows";
import { groupBy } from "./search";
import { fillCosts, grossCentavos, slippageCentavos, slippedOptionPrice } from "./fill-pricing";
import { isAtOrBefore } from "./instant";
import { assertDefined, invariant } from "./invariant";
import {
  OPTION_STRIKE_DERIVED_NOTE,
  OPTION_STRIKE_UNCONFIRMED_NOTE,
  STALE_MARK_RESCALED_ACROSS_CORPORATE_ACTION_NOTE,
  strikeAdjustmentNotesOf,
} from "./notes";
import { codeUnitCompare, sortUnique } from "./order";
import { rebaseExerciseFillUnits, settleLeg } from "./propose-settlement";
import { resolveSeries } from "./resolve-series";
import { toCentavos, toQuantity } from "./scalars";
import { splitFactorProduct } from "./split-factor";
import { corporateActionIntegrityError } from "./validate-view-integrity";
import { computeWalkForward } from "./walk-forward";

type PendingEntry = {
  legs: Leg[];
  maxLoss: Centavos | "unbounded";
  limitBreaches: LimitBreach[];
  signalSession: SessionDate;
};
type PendingExit = { operationId: string; rule: ExitRule };
type SlippageEntry = { session: SessionDate; amount: Centavos };

// Produced at an operation's expiry (ADR-0013 "Settlement in a run"): optionsPnl is the
// premium-only realization of every option leg (each folds its own premium into pnl the
// same way whether it expired worthless or was exercised/assigned — the intrinsic value of
// an exercised/assigned leg shows up entirely in the stock trade it produces, never twice)
// plus the matched realization of any stock quantity a settlement fill immediately closed
// against the operation's own stock leg (a covered call assigned against its stock, a
// vertical with both legs in the money). residualQuantity is what does not net out (ADR:
// "residual stock ... is closed at the next session's open"), signed (+long/-short),
// residualAvgCost its cost basis; both are meaningless when residualQuantity is zero (and
// never stored: a zero residual always closes the same session, through finalizeSettlement,
// never through state.pendingSettlements).
// optionGainSoFarCentavos is the slice of pnlSoFar contributed by a worthless-expiring option
// leg (ADR-0013 "Taxes" optionGain bucket): the rest of pnlSoFar — matched
// stock netting and an exercised/assigned leg's own premium — stays in the stock bucket, since
// that premium folds into the stock trade the exercise or assignment produced.
// residualAvgCostCentavos is a `DecimalString`, not a rounded `number`: it is
// a cost basis *per share*, `buyCost.div(buyQty)` (or the sell-side equivalent), which does
// not generally land on a whole centavo — rounding it here, before the residual close ever
// reads it back, silently mis-nets the residual's own pnl by up to half a centavo per share.
type PendingSettlement = {
  op: Operation;
  settlement: LegSettlement[];
  pnlSoFar: number;
  optionGainSoFarCentavos: number;
  residualQuantity: number;
  residualAvgCostCentavos: DecimalString;
  expirySession: SessionDate;
};

type BacktestState = {
  cash: number;
  openOperations: Operation[];
  fills: SimulatedFill[];
  operations: SimulatedOperation[];
  missedEntries: MissedEntry[];
  limitBreaches: SessionLimitBreach[];
  equityCurve: EquityPoint[];
  held: boolean[];
  slippageEntries: SlippageEntry[];
  // Carried in the checkpoint state, not call-local: a resumed run must pair each equity
  // point with the risk-free rate visible at that same session's close, or a chunked run's
  // Sharpe (and walk-forward windows) diverge from an uninterrupted call over the same period.
  rfPerSession: DecimalString[];
  // ADR-0041: parallel to equityCurve, true when at least one universe ticker has a D1 candle
  // visible by this session's close. Combined with firstTradableSession at metrics time to
  // derive the observed subsequence a candle-less gap or a warm-up prefix must not dilute.
  hasCandle: boolean[];
  // The first period session at which evaluateStrategy did not return "insufficient_data" for
  // every instrument in the universe (ADR-0041): null until found, then fixed for the rest of
  // the run — carried in the checkpoint so a resumed run agrees with an uninterrupted one on
  // exactly which leading sessions were warm-up.
  firstTradableSession: SessionDate | null;
  runningPeak: number;
  pendingEntries: Record<string, PendingEntry>;
  retryCount: Record<string, number>;
  pendingExits: Record<string, PendingExit>;
  pendingSettlements: Record<string, PendingSettlement>;
  entryCosts: Record<string, Centavos[]>;
  entryMaxLoss: Record<string, Centavos | "unbounded">;
  currentMonthKey: string | null;
  currentMonthStockSales: number;
  currentMonthStockGain: number;
  currentMonthOptionGain: number;
  taxesFinalized: MonthlyTax[];
  pendingTaxDeduction: { monthKey: string; tax: number } | null;
  operationSeq: number;
  equityClampEngaged: boolean;
  // #69 part 2, set once a settlement sees at least one option leg whose
  // strike carried a factor ex-dated exactly on that settlement's own session, applied with
  // confidence since that session's own epoch could not exist yet (option-strike.ts).
  optionStrikeDerivedAcrossCorporateActionNoted: boolean;
  // Set once a settlement sees at least one option leg whose strike carried a factor ex-dated
  // earlier, with no epoch of its own confirming it: a genuine ingestion gap and an
  // already-correct, early-dated backfill (ADR-0056 step 2) are indistinguishable from here, so
  // the strike is kept as read but flagged, run-wide, rather than guessed either way.
  optionStrikeUnconfirmedAcrossCorporateActionNoted: boolean;
  // Set once lastKnownLegPrice rescales a leg's stale mark across a corporate-action ex-date
  // visible on its underlying (issue #273), the same run-wide rollup the two notes above use.
  stalePriceRescaledAcrossCorporateActionNoted: boolean;
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
    slippageEntries: [],
    rfPerSession: [],
    hasCandle: [],
    firstTradableSession: null,
    runningPeak: initialCapital,
    pendingEntries: {},
    retryCount: {},
    pendingExits: {},
    pendingSettlements: {},
    entryCosts: {},
    entryMaxLoss: {},
    currentMonthKey: null,
    currentMonthStockSales: 0,
    currentMonthStockGain: 0,
    currentMonthOptionGain: 0,
    taxesFinalized: [],
    pendingTaxDeduction: null,
    operationSeq: 0,
    equityClampEngaged: false,
    optionStrikeDerivedAcrossCorporateActionNoted: false,
    optionStrikeUnconfirmedAcrossCorporateActionNoted: false,
    stalePriceRescaledAcrossCorporateActionNoted: false,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidEquityPoint(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    Number.isFinite(value.equity) &&
    Number.isFinite(value.cash) &&
    typeof value.drawdown === "string"
  );
}

function isValidPendingEntry(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.legs);
}

function isValidPendingExit(value: unknown): boolean {
  return isPlainObject(value) && typeof value.operationId === "string" && isPlainObject(value.rule);
}

// Every `DecimalString` field on a resumed checkpoint is only `typeof === "string"` away from
// user-editable JSON: a value like `"nope"` passes that check but blows up `new Decimal(...)`
// deep inside the run. Checked once here so every corrupt decimal field is a typed
// checkpoint_mismatch, never a thrown DecimalError partway through the resumed run.
function isDecimalString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

function isValidOperationLeg(value: unknown): boolean {
  return isPlainObject(value) && isDecimalString(value.entryPrice);
}

function isValidOperation(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.legs) && value.legs.every(isValidOperationLeg);
}

function isValidPendingSettlement(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isPlainObject(value.op) &&
    Array.isArray(value.settlement) &&
    Number.isFinite(value.pnlSoFar) &&
    Number.isFinite(value.optionGainSoFarCentavos) &&
    Number.isSafeInteger(value.residualQuantity) &&
    // A pending settlement only ever exists for a residual still awaiting its own close:
    // `resolveExpiringOperations` never stores one for
    // residualQuantity === 0, and `resolvePendingSettlementResidualFills` /
    // `closePeriodEnd` always remove it in the same step that closes the residual, so a
    // resumed checkpoint carrying one with a zero residualQuantity is corrupt input, not a
    // shape `toQuantity(Math.abs(0))` should throw an invariant over on the next session.
    value.residualQuantity !== 0 &&
    isDecimalString(value.residualAvgCostCentavos) &&
    typeof value.expirySession === "string"
  );
}

function isValidMonthlyTax(value: unknown): boolean {
  return isPlainObject(value) && Number.isFinite(value.tax);
}

function isValidSlippageEntry(value: unknown): boolean {
  return isPlainObject(value) && typeof value.session === "string" && Number.isFinite(value.amount);
}

// Every field runBacktest dereferences off a resumed state — every element of equityCurve,
// pendingEntries, pendingExits and taxesFinalized, and every numeric field including a NaN or
// Infinity a JSON round-trip would otherwise smuggle through as "typeof number" — checked once so
// a caller's corrupt or hand-edited checkpoint is always a typed checkpoint_mismatch, never a
// thrown TypeError or a silently NaN-poisoned run partway through.
function isValidCheckpointState(raw: unknown): raw is BacktestState {
  if (!isPlainObject(raw)) return false;
  const arrayFields = [
    "equityCurve",
    "openOperations",
    "fills",
    "operations",
    "missedEntries",
    "limitBreaches",
    "held",
    "slippageEntries",
    "rfPerSession",
    "taxesFinalized",
    "hasCandle",
  ] as const;
  if (arrayFields.some((field) => !Array.isArray(raw[field]))) return false;
  if (typeof raw.firstTradableSession !== "string" && raw.firstTradableSession !== null) {
    return false;
  }

  // held, rfPerSession and hasCandle are parallel to equityCurve by construction (each session's
  // loop iteration pushes to all four together, ADR-0041) — a resumed checkpoint whose caller
  // truncated or padded just one of them would otherwise read past the end of a shorter array
  // (assertDefined throwing partway through computeBacktestMetrics) or silently zero-pad a
  // longer equityCurve's tail sessions to false/"0" instead of failing checkpoint_mismatch here.
  const equityCurveLength = (raw.equityCurve as unknown[]).length;
  const parallelArrayFields = ["held", "rfPerSession", "hasCandle"] as const;
  if (parallelArrayFields.some((field) => (raw[field] as unknown[]).length !== equityCurveLength)) {
    return false;
  }

  const recordFields = [
    "pendingEntries",
    "retryCount",
    "pendingExits",
    "pendingSettlements",
    "entryCosts",
    "entryMaxLoss",
  ] as const;
  if (recordFields.some((field) => !isPlainObject(raw[field]))) return false;

  const numberFields = [
    "cash",
    "runningPeak",
    "currentMonthStockSales",
    "currentMonthStockGain",
    "currentMonthOptionGain",
    "operationSeq",
  ] as const;
  if (numberFields.some((field) => !Number.isFinite(raw[field]))) return false;

  if (typeof raw.currentMonthKey !== "string" && raw.currentMonthKey !== null) return false;
  if (typeof raw.equityClampEngaged !== "boolean") return false;
  if (typeof raw.optionStrikeDerivedAcrossCorporateActionNoted !== "boolean") return false;
  if (typeof raw.optionStrikeUnconfirmedAcrossCorporateActionNoted !== "boolean") return false;
  if (typeof raw.stalePriceRescaledAcrossCorporateActionNoted !== "boolean") return false;
  if (raw.pendingTaxDeduction !== null) {
    if (!isPlainObject(raw.pendingTaxDeduction)) return false;
    if (!Number.isFinite(raw.pendingTaxDeduction.tax)) return false;
  }

  if (!(raw.equityCurve as unknown[]).every(isValidEquityPoint)) return false;
  if (!(raw.openOperations as unknown[]).every(isValidOperation)) return false;
  if (!Object.values(raw.pendingEntries as Record<string, unknown>).every(isValidPendingEntry)) {
    return false;
  }
  if (!Object.values(raw.pendingExits as Record<string, unknown>).every(isValidPendingExit)) {
    return false;
  }
  if (
    !Object.values(raw.pendingSettlements as Record<string, unknown>).every(
      isValidPendingSettlement,
    )
  ) {
    return false;
  }
  if (!(raw.taxesFinalized as unknown[]).every(isValidMonthlyTax)) return false;
  if (!(raw.slippageEntries as unknown[]).every(isValidSlippageEntry)) return false;

  return true;
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
function indexTickerSessions<T extends { ticker: Ticker; session: SessionDate; asOf: Instant }>(
  rows: readonly T[],
): Map<Ticker, SessionRows<T>> {
  return new Map(
    [...groupBy(rows, (row) => row.ticker)].map(([ticker, bucket]) => [
      ticker,
      indexBySession(bucket),
    ]),
  );
}

function candleFor(
  candlesByTicker: Map<Ticker, SessionRows<Candle>>,
  ticker: Ticker,
  session: SessionDate,
  visibleAt: Instant,
): Candle | null {
  return rowOnSession(candlesByTicker.get(ticker), session, visibleAt);
}

type KnownPrice = { price: DecimalString; session: SessionDate };

// Both call sites only ask about a ticker that already has an open operation, which can only
// exist because a fill found a candle for it on or before this same session in an
// uninterrupted run — but a resumed run's view can legitimately lack that history if the
// caller didn't carry it over, so both callers turn a null into insufficient_data. The row's own
// session is exposed alongside its price so a caller (lastKnownRescaledPrice) can tell a
// genuinely stale mark from a fresh one, rather than only the price itself.
function lastKnownCloseRow(
  candlesByTicker: Map<Ticker, SessionRows<Candle>>,
  ticker: Ticker,
  uptoSession: SessionDate,
  visibleAt: Instant,
): KnownPrice | null {
  const row = lastKnownRow(candlesByTicker.get(ticker), uptoSession, visibleAt);
  return row ? { price: row.close, session: row.session } : null;
}

// The option-leg mirror of lastKnownCloseRow (ADR-0014 Q42, a stale mark carried forward from
// the series' last trade): close before average, matching the same ladder priceOperation's
// own market-price resolution uses.
function lastKnownOptionPriceRow(
  optionPricesByTicker: Map<Ticker, SessionRows<OptionDayPrice>>,
  ticker: Ticker,
  uptoSession: SessionDate,
  visibleAt: Instant,
): KnownPrice | null {
  const latest = lastKnownRow(optionPricesByTicker.get(ticker), uptoSession, visibleAt);
  if (latest === null) return null;
  const price = latest.close ?? latest.average;
  if (!price) return null;
  return { price, session: latest.session };
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
  kind: "stock" | "option" = "stock",
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
    collections: kind === "option" ? ["optionPrices"] : ["candles"],
  };
  return { ok: false, error: { code: "insufficient_data", needed } };
}

// grossCentavos, fillCosts, slippedOptionPrice and slippageCentavos moved to
// ./fill-pricing.ts (score's counterfactual fill also needs them, ADR-0014 Q40); this file
// re-exports them under their original names to keep every call site below unchanged.

function operationId(
  seq: number,
  strategyVersionId: string,
  ticker: Ticker,
  session: SessionDate,
): string {
  return `${strategyVersionId}:${ticker}:${session}:${String(seq)}`;
}

// Exhaustive over EvaluationOutcome so a future outcome the type gains is a compile error here,
// not a silently wrong reason. no_series_match and degenerate_strikes are reachable for an
// option-legged run (#23): evaluateStrategy now selects strikes for a structure with option
// legs and can fail to find a matching series or land on degenerate strikes.
function missedEntryReasonFor(outcome: EvaluationOutcome | undefined): MissedEntryReason {
  if (outcome === "unsizeable") return "unsizeable";
  if (outcome === "no_series_match") return "no_series_match";
  if (outcome === "degenerate_strikes") return "degenerate_strikes";
  // Every remaining EvaluationOutcome ("signal", "conditions_not_met", "insufficient_data") and
  // "undefined" (no matching evaluation record) fall back to "no_trades", the only
  // MissedEntryReason a fill-time failure with none of the above outcomes can be.
  return "no_trades";
}

// A leg's realized (or marked) pnl at a given price: every leg of an operation on underlying U
// — stock and option alike — rebases through `splitFactor` (I1, ADR-0014 Q51, extended to option
// legs by #69 part 2: B3 scales option holdings and re-strikes the listed series by the same
// factor as the underlying, rather than forcing a series rollover).
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
    return invalidInput("view.calendar", `duplicate calendar date ${calendarDupe.duplicateKey}`);
  }
  const sortedCalendar = calendarDupe.value;
  const periodSessions = sortedCalendar.filter(
    (s) => s.date >= config.period.from && s.date <= config.period.to,
  );
  if (periodSessions.length === 0) {
    return invalidInput("config.period", "no calendar session falls inside the requested period");
  }

  // Validated here, upfront, rather than left to `evaluateStrategy`'s own per-session check:
  // a resumed chunk's own fills and marks read `view.corporateActions`
  // through `corporateActionFactorThrough` for this session's still-open operations before
  // `evaluateStrategy` is ever called for it, so that per-session check alone left this
  // reachable through `splitFactorProduct`'s invariant on a resumed run's very first session.
  for (const [index, f] of view.corporateActions.entries()) {
    if (!parseDecimal(f.factor).gt(0)) {
      return invalidInput(
        `view.corporateActions[${String(index)}].factor`,
        "a corporate-action factor must be strictly positive",
      );
    }
  }
  const corporateActionError = corporateActionIntegrityError(view.corporateActions);
  if (corporateActionError) return { ok: false, error: corporateActionError };

  const candlesByTicker = indexTickerSessions(view.candles.filter((c) => c.timeframe === "D1"));

  const corporateActionsByTicker = groupBy(view.corporateActions, (f) => f.ticker);

  const optionPricesByTicker = indexTickerSessions(view.optionPrices);

  // A leg's fill readiness and price, uniform over the fill sources ADR-0013 "Fills" fixes
  // for a daily run: a stock leg at the next session's open, an option leg at the next
  // session's average traded price plus slippage. An operation's entry or exit fills
  // atomically — every leg must be ready in the same session, or the whole thing retries
  // (ADR-0014 Q38, Q52). `tradeSide` is the side of this fill itself (a leg's own `side` on
  // entry, the opposite on exit), since slippage direction depends on which way this
  // particular trade goes, not on the leg's resting side.
  function legFillPrice(
    leg: Leg,
    session: TradingSession,
    tradeSide: Side,
  ):
    | {
        ready: true;
        price: DecimalString;
        reference: DecimalString;
        source: "next_session_open" | "next_session_average";
        kind: "stock" | "option";
      }
    | { ready: false } {
    if (leg.role === "stock") {
      const candle = candleFor(candlesByTicker, leg.ticker, session.date, session.close);
      if (!candle || candle.tradedQuantity <= 0) return { ready: false };
      return {
        ready: true,
        price: candle.open,
        reference: candle.open,
        source: "next_session_open",
        kind: "stock",
      };
    }
    const dayPrice = rowOnSession(
      optionPricesByTicker.get(leg.ticker),
      session.date,
      session.close,
    );
    if (!dayPrice || dayPrice.tradedQuantity <= 0 || !dayPrice.average) return { ready: false };
    const filled = slippedOptionPrice(
      dayPrice.average,
      tradeSide,
      config.costModel.optionSlippageRate,
    );
    return {
      ready: true,
      price: filled,
      reference: dayPrice.average,
      source: "next_session_average",
      kind: "option",
    };
  }

  // Every option leg of an operation lists the same expiry (ADR-0014 Q43); the first
  // resolvable one is the operation's own. null for a stock-only operation.
  function resolveOperationExpiry(legs: readonly Leg[], at: Instant): Result<SessionDate | null> {
    const optionLegs = legs.filter((leg) => leg.role !== "stock");
    for (const leg of optionLegs) {
      const series = resolveSeries(view, leg.ticker, at);
      if (series) return { ok: true, value: series.expiry };
    }
    if (optionLegs.length > 0) {
      return {
        ok: false,
        error: {
          code: "missing_instrument",
          ticker: assertDefined(optionLegs[0], "run-backtest: optionLegs is non-empty here").ticker,
        },
      };
    }
    return { ok: true, value: null };
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
    const result = splitFactorProduct(factors, openedAt, through);
    // runBacktest's own upfront validation above rejects the whole, unfiltered
    // view.corporateActions with invalid_input before the session loop below ever starts
    // (a resumed chunk's first session fills and marks before evaluateStrategy
    // is ever called for it, so that per-session check alone left this reachable), so a
    // non-positive factor can never reach this call.
    invariant(
      result.ok,
      "run-backtest: the upfront corporateActions validation already rejected a non-positive factor",
    );
    return result.value;
  }

  // A leg's or a pending settlement residual's own current mark: a stock reads the underlying's
  // last known close, an option leg its own series' last known day price (ADR-0014 Q42). The
  // daily equity mark, the period-end sweep and a settlement's own residual valuation each call
  // this, every one of them at the same reading instant (I1). Issue #273: a stale row — one
  // whose own session predates `uptoSession` — sits on whatever price scale its own session had,
  // which a corporate action ex-dated since then has already moved the held quantity away from
  // (`corporateActionFactorThrough`, keyed by the operation's own underlying the same way every
  // other leg rebase in this file is). Rescaling by that same factor keeps the mark on the scale
  // the caller's own effective quantity expects; a fresh row (its own session already
  // `uptoSession`) is never stale by definition and skips this. The rescaled value is kept at
  // full decimal.js precision (`toDecimalStringAtLeastScale`, never rounded to `PRICE_SCALE`
  // here): rounding before the caller multiplies by its own effective quantity would manufacture
  // or drop P&L the unrounded multiplication never would (correctness round 1, #273 follow-up).
  function lastKnownRescaledPrice(
    role: "stock" | "option",
    ticker: Ticker,
    underlying: Ticker,
    uptoSession: SessionDate,
    visibleAt: Instant,
  ): DecimalString | null {
    const known =
      role === "stock"
        ? lastKnownCloseRow(candlesByTicker, ticker, uptoSession, visibleAt)
        : lastKnownOptionPriceRow(optionPricesByTicker, ticker, uptoSession, visibleAt);
    if (known === null) return null;
    if (known.session === uptoSession) return known.price;
    const rescale = corporateActionFactorThrough(underlying, known.session, uptoSession, visibleAt);
    if (rescale.eq(1)) return known.price;
    state.stalePriceRescaledAcrossCorporateActionNoted = true;
    return toDecimalStringAtLeastScale(parseDecimal(known.price).mul(rescale), PRICE_SCALE);
  }

  function lastKnownLegPrice(
    leg: Leg,
    underlying: Ticker,
    uptoSession: SessionDate,
    visibleAt: Instant,
  ): DecimalString | null {
    return lastKnownRescaledPrice(
      leg.role === "stock" ? "stock" : "option",
      leg.ticker,
      underlying,
      uptoSession,
      visibleAt,
    );
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

  // A checkpoint object is a caller-owned value that may be resumed from more than once (a
  // caller retrying a failed downstream step, or exploring more than one continuation from the
  // same pause point); mutating it in place here would leave the second resume looking at a
  // state whose equityCurve already grew past what its own cursor promises, failing
  // checkpoint_mismatch instead of reproducing the first resume's result (I4). `structuredClone`,
  // unlike a JSON round-trip, preserves a corrupt `NaN` or `Infinity` numeric field rather than
  // silently coercing it to `null`, so the validity check below still catches it.
  const clonedResumeState =
    input.resume === undefined ? undefined : structuredClone(input.resume.state);

  // A caller round-trips `state` through storage as plain JSON, so it can carry any shape at
  // runtime regardless of what BacktestCheckpoint['state'] says at compile time — every field
  // this module later dereferences is checked here, once, so a malformed shape is always a typed
  // checkpoint_mismatch, never a thrown TypeError partway through the run.
  if (input.resume !== undefined && !isValidCheckpointState(clonedResumeState)) {
    return checkpointMismatch("equityCurve.length:object", "equityCurve.length:not-an-object");
  }

  const state: BacktestState =
    input.resume === undefined
      ? initialState(config.initialCapital)
      : (clonedResumeState as BacktestState);

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
      toCentavos(state.currentMonthOptionGain),
      config.costModel,
    );
    state.taxesFinalized.push(tax);
    state.currentMonthStockSales = 0;
    state.currentMonthStockGain = 0;
    state.currentMonthOptionGain = 0;
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
      state.retryCount[ticker] = (state.retryCount[ticker] ?? 0) + 1;
      const legFills = pending.legs.map((leg) => legFillPrice(leg, session, leg.side));
      const allLegsReady = legFills.every((f) => f.ready);
      if (allLegsReady) {
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
        // Every leg's signal-time quantity is rescaled the same way.
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
        const legs: OperationLeg[] = pending.legs.map((leg, legIndex) => {
          const legFill = assertDefined(
            legFills[legIndex],
            "run-backtest: legFills has one entry per leg",
          );
          invariant(legFill.ready, "run-backtest: allLegsReady already checked every leg");
          return {
            role: leg.role,
            side: leg.side,
            ticker: leg.ticker,
            quantity: toQuantity(
              assertDefined(
                rescaledQuantities[legIndex],
                "run-backtest: rescaledQuantities has one entry per leg",
              ),
            ),
            entryPrice: legFill.price,
          };
        });
        // Resolved before any cash or fill mutation below: a resumed run whose view is
        // missing an option leg's series at fill time (the same class of gap resolveSeries
        // already catches at settlement) must fail before touching
        // state, not leave a half-mutated entry.
        const expiryResult = resolveOperationExpiry(pending.legs, session.close);
        if (!expiryResult.ok) return expiryResult;
        const entryCosts: Centavos[] = [];
        for (const [legIndex, leg] of legs.entries()) {
          const legFill = assertDefined(
            legFills[legIndex],
            "run-backtest: legFills has one entry per leg",
          );
          invariant(legFill.ready, "run-backtest: allLegsReady already checked every leg");
          const costs = fillCosts(config.costModel, legFill.price, leg.quantity, legFill.kind);
          entryCosts.push(costs);
          const gross = grossCentavos(legFill.price, leg.quantity).round().toNumber();
          state.cash -= (leg.side === "buy" ? 1 : -1) * gross + costs;
          // A short entry is itself a stock sell (ADR-0004's exemption reads "stock
          // sells in the month", any sell fill, not only an exit closing a long): the
          // exit-fill loop below only sees the covering buy for this leg, so it never
          // counts, and this is the only place that can.
          if (leg.side === "sell" && leg.role === "stock") {
            state.currentMonthStockSales += gross;
          }
          if (legFill.kind === "option") {
            state.slippageEntries.push({
              session: session.date,
              amount: slippageCentavos(legFill.reference, legFill.price, leg.quantity),
            });
          }
          state.fills.push({
            ticker: leg.ticker,
            side: leg.side,
            quantity: leg.quantity,
            price: legFill.price,
            session: session.date,
            at: session.open,
            costs,
            operationId: id,
            source: legFill.source,
          });
        }
        state.openOperations.push({
          id,
          underlying: ticker,
          legs,
          expiry: expiryResult.value,
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
      const legFills = op.legs.map((leg) =>
        legFillPrice(leg, session, leg.side === "buy" ? "sell" : "buy"),
      );
      if (!legFills.every((f) => f.ready)) continue;

      const entryCosts = state.entryCosts[op.id] ?? op.legs.map(() => toCentavos(0));
      // Read at this same session's close, the same instant legFillPrice above already used
      // to decide the stock leg's candle is visible: a factor whose own asOf sits between
      // this session's open and close must apply to this fill exactly when it would also
      // apply to a same-session mark of an operation that stayed open instead of exiting
      // (I1), never on some other instant that could disagree over which factors are
      // visible yet.
      const splitFactor = corporateActionFactorThrough(
        op.underlying,
        op.openedAt,
        session.date,
        session.close,
      );
      // Split by leg role: an option leg closed before expiry — never
      // exercised or assigned, so never folded into a stock trade — is its own taxable
      // result, ADR-0013's optionGain bucket; a stock leg's own pnl stays in stockGain.
      let stockPnl = new Decimal(0);
      let optionPnl = new Decimal(0);
      for (let legIndex = 0; legIndex < op.legs.length; legIndex += 1) {
        const leg = assertDefined(op.legs[legIndex], "run-backtest: legIndex within bounds");
        const legFill = assertDefined(legFills[legIndex], "run-backtest: legIndex within bounds");
        invariant(legFill.ready, "run-backtest: every leg was already checked ready above");
        const exitSide: "buy" | "sell" = leg.side === "buy" ? "sell" : "buy";
        const entryCost = entryCosts[legIndex] ?? toCentavos(0);

        // The exit trades an integer number of units; a grouping factor that does not divide
        // `leg.quantity` evenly leaves a sub-one-unit residue, cash-settled at this same fill's
        // price rather than dropped or rounded into a unit that was never granted (ADR-0014 Q51,
        // extended to option legs by #69 part 2: B3 scales option holdings by the same factor as
        // the underlying, rather than forcing a series rollover). `pnl` is computed once, below,
        // from the full unrounded effective quantity, so it already accounts for both the traded
        // units and the residue.
        const tradedTicker = leg.role === "stock" ? op.underlying : leg.ticker;
        const rawEffectiveQuantity = new Decimal(leg.quantity).div(splitFactor);
        const effectiveUnits = Math.floor(rawEffectiveQuantity.toNumber());
        // An adversarial or corrupt factor (near-zero, e.g. 1e-15) blows this count up past what
        // a real unit count can be; that is invalid input, not a value toQuantity should throw
        // an invariant over.
        if (effectiveUnits > 0 && !Number.isSafeInteger(effectiveUnits)) {
          return invalidInput(
            "view.corporateActions",
            `split factor produces a non-integer-safe effective unit count for ${tradedTicker}`,
          );
        }
        const residue = rawEffectiveQuantity.sub(effectiveUnits);
        let costs = toCentavos(0);
        if (effectiveUnits > 0) {
          const q = toQuantity(effectiveUnits);
          costs = fillCosts(config.costModel, legFill.price, q, legFill.kind);
          const gross = grossCentavos(legFill.price, q).round().toNumber();
          state.cash += (exitSide === "sell" ? 1 : -1) * gross - costs;
          if (legFill.kind === "option") {
            state.slippageEntries.push({
              session: session.date,
              amount: slippageCentavos(legFill.reference, legFill.price, q),
            });
          }
          state.fills.push({
            ticker: tradedTicker,
            side: exitSide,
            quantity: q,
            price: legFill.price,
            session: session.date,
            at: session.open,
            costs,
            operationId: op.id,
            source: legFill.source,
          });
          if (exitSide === "sell" && leg.role === "stock") state.currentMonthStockSales += gross;
        }
        if (residue.isPositive()) {
          const residueGross = grossCentavos(legFill.price, residue).round().toNumber();
          state.cash += (exitSide === "sell" ? 1 : -1) * residueGross;
          if (exitSide === "sell" && leg.role === "stock") {
            state.currentMonthStockSales += residueGross;
          }
        }
        const legPnl = legPnlCentavos(leg, legFill.price, splitFactor).sub(costs).sub(entryCost);
        if (leg.role === "stock") {
          stockPnl = stockPnl.add(legPnl);
        } else {
          optionPnl = optionPnl.add(legPnl);
        }
      }
      const pnlCentavos = toCentavos(stockPnl.add(optionPnl).round().toNumber());
      state.currentMonthStockGain += stockPnl.round().toNumber();
      state.currentMonthOptionGain += optionPnl.round().toNumber();
      const pendingExit = assertDefined(
        state.pendingExits[opId],
        "run-backtest: opId is a key of pendingExits in this loop",
      );
      state.operations.push({
        id: op.id,
        underlying: op.underlying,
        legs: op.legs,
        expiry: op.expiry,
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

  function finalizeSettlement(
    pending: PendingSettlement,
    pnl: number,
    closedAt: SessionDate,
    residualSettledBy: "trade" | "period_end" | null,
  ): void {
    state.operations.push({
      id: pending.op.id,
      underlying: pending.op.underlying,
      legs: pending.op.legs,
      expiry: pending.op.expiry,
      openedAt: pending.op.openedAt,
      strategyVersionId: pending.op.strategyVersionId,
      rolledFrom: pending.op.rolledFrom,
      pnl: toCentavos(Math.round(pnl)),
      // entryMaxLoss is set for every id in state.openOperations at entry time and only
      // deleted here, so a settling operation always has one; the fallback only guards the
      // type, mirroring the same pattern at every other operation-closing call site.
      /* v8 ignore next */
      maxLoss: state.entryMaxLoss[pending.op.id] ?? toCentavos(0),
      status: "expired",
      closedAt,
      settlement: pending.settlement,
      residualSettledBy,
    });
    Reflect.deleteProperty(state.entryCosts, pending.op.id);
    Reflect.deleteProperty(state.entryMaxLoss, pending.op.id);
    // An exit signaled while this operation was still open but only filled after — or never
    // fills — before its own expiry is superseded by settlement: settlement wins (ADR-0014
    // Q52's hygiene-first reading), so any pending exit for this operation is dropped here,
    // else the next session's resolvePendingExitFills would find no open operation left to
    // fill it against.
    Reflect.deleteProperty(state.pendingExits, pending.op.id);
  }

  // Step 1c: close any residual stock a prior session's settlement left open, at this
  // session's own open (ADR-0013 "Settlement in a run"). Retried indefinitely like a
  // pending exit (ADR-0014 Q52's hygiene-first reading extends naturally here) until the
  // period-end sweep marks it instead.
  //
  // `pending.residualQuantity`/`residualAvgCostCentavos` are frozen at the expiry session's own
  // scale (ADR-0013 "Settlement in a run" built them from that session's fills): like any other
  // held position this file rebases (Q51), a split ex-dated between expiry and this later fill
  // session moves them, same direction as `legPnlCentavos` (cost ×factor, quantity ÷factor). The
  // real trade can only execute a whole number of shares, so the rebased quantity floors toward
  // zero the same way an exercised/assigned leg's own fill does, with the fractional residue
  // cash-settled immediately at this same fill's price (mirroring `resolvePendingExitFills`); the
  // pnl below still uses the full unrounded rebased quantity, not the floored trade count.
  function resolvePendingSettlementResidualFills(session: TradingSession): Result<void> {
    for (const [opId, pending] of Object.entries(state.pendingSettlements)) {
      const candle = candleFor(candlesByTicker, pending.op.underlying, session.date, session.close);
      if (!candle || candle.tradedQuantity <= 0) continue;
      const residualFactor = corporateActionFactorThrough(
        pending.op.underlying,
        pending.expirySession,
        session.date,
        session.close,
      );
      const rawEffectiveResidual = new Decimal(pending.residualQuantity).div(residualFactor);
      const effectiveUnits = rawEffectiveResidual.toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
      if (effectiveUnits !== 0 && !Number.isSafeInteger(effectiveUnits)) {
        return invalidInput(
          "view.corporateActions",
          `split factor produces a non-integer-safe effective unit count for ${pending.op.underlying}`,
        );
      }
      const residue = rawEffectiveResidual.sub(effectiveUnits);
      const effectiveAvgCostCentavos = new Decimal(pending.residualAvgCostCentavos).mul(
        residualFactor,
      );

      let costs = toCentavos(0);
      if (effectiveUnits !== 0) {
        const side: "buy" | "sell" = effectiveUnits > 0 ? "sell" : "buy";
        const q = toQuantity(Math.abs(effectiveUnits));
        costs = fillCosts(config.costModel, candle.open, q, "stock");
        const gross = grossCentavos(candle.open, q).round().toNumber();
        state.cash += (side === "sell" ? 1 : -1) * gross - costs;
        if (side === "sell") state.currentMonthStockSales += gross;
        state.fills.push({
          ticker: pending.op.underlying,
          side,
          quantity: q,
          price: candle.open,
          session: session.date,
          at: session.open,
          costs,
          operationId: opId,
          source: "next_session_open",
        });
      }
      if (!residue.isZero()) {
        const residueGross = grossCentavos(candle.open, residue.abs()).round().toNumber();
        state.cash += (residue.isPositive() ? 1 : -1) * residueGross;
        if (residue.isPositive()) state.currentMonthStockSales += residueGross;
      }
      const residualPnl = parseDecimal(candle.open)
        .sub(effectiveAvgCostCentavos.div(CENTAVOS_PER_REAL))
        .mul(rawEffectiveResidual.isNeg() ? -1 : 1)
        .mul(CENTAVOS_PER_REAL)
        .mul(rawEffectiveResidual.abs())
        .sub(costs)
        .add(pending.pnlSoFar)
        .round()
        .toNumber();
      // The residual close itself (a stock trade) and pending.pnlSoFar's exercised/assigned
      // slice both stay in stockGain; only the worthless-leg slice carried in pnlSoFar,
      // already isolated at settlement time, is optionGain.
      state.currentMonthStockGain += residualPnl - pending.optionGainSoFarCentavos;
      state.currentMonthOptionGain += pending.optionGainSoFarCentavos;
      finalizeSettlement(pending, residualPnl, pending.expirySession, "trade");
      Reflect.deleteProperty(state.pendingSettlements, opId);
    }
    return { ok: true, value: undefined };
  }

  // Step 1d: settle every open operation reaching its own expiry this session (ADR-0013
  // "Settlement in a run", ADR-0014 Q41). In-the-money option legs are exercised or
  // assigned at the strike; out-of-the-money legs expire worthless; a stock leg is kept.
  // The settlement stock fills net against the operation's own stock leg, if any, by
  // average-cost matching: the matched quantity is realized now, the rest is a residual
  // closed at the next session's open (or marked at period_end when there is none).
  function resolveExpiringOperations(session: TradingSession): Result<void> {
    const stillOpen: Operation[] = [];
    for (const op of state.openOperations) {
      if (op.expiry !== session.date) {
        stillOpen.push(op);
        continue;
      }
      // Settlement is an exercise/assignment decision, not a valuation: it must read this same
      // expiry session's own close, never a stale one carried forward from an earlier session
      // (unlike an ordinary mark, ADR-0014 Q42), or an untraded expiry session would settle
      // against a price that was never actually seen on it.
      const expirySessionCandle = candleFor(
        candlesByTicker,
        op.underlying,
        session.date,
        session.close,
      );
      if (expirySessionCandle === null) {
        return missingMarkError(op.underlying, op.openedAt, sortedCalendar, session.close);
      }
      const underlyingClose = expirySessionCandle.close;

      // Every leg, stock and option alike, rebases through a corporate action the same way an
      // open position's mark and an exit already do (I1, ADR-0014 Q51, extended to option legs
      // by #69 part 2): the settlement's own bucketing must land on the same effective unit
      // count and cost basis a same-session mark of this operation would.
      const splitFactor = corporateActionFactorThrough(
        op.underlying,
        op.openedAt,
        session.date,
        session.close,
      );

      const settlement: LegSettlement[] = [];
      let optionsPnl = new Decimal(0);
      // The worthless-leg slice of optionsPnl: never folded into a stock
      // trade (nothing is exercised or assigned), so it is the operation's own optionGain,
      // not stockGain — unlike an exercised/assigned leg's premium, which stays in optionsPnl
      // and folds into the stock trade the exercise or assignment produced.
      let worthlessOptionPnl = new Decimal(0);
      let buyQty = new Decimal(0);
      let buyCost = new Decimal(0);
      let sellQty = new Decimal(0);
      let sellProceeds = new Decimal(0);
      let settlementCosts = new Decimal(0);
      let anyStrikeDerived = false;
      let anyStrikeUnconfirmed = false;

      for (const [legIndex, leg] of op.legs.entries()) {
        if (leg.role === "stock") {
          settlement.push({
            leg: leg as OperationLeg & { role: "stock" },
            outcome: "kept",
            intrinsicValue: null,
            fills: [],
            residualValue: toCentavos(0),
          });
          const effectiveQuantity = new Decimal(leg.quantity).div(splitFactor);
          const effectiveEntryPrice = parseDecimal(leg.entryPrice).mul(splitFactor);
          if (leg.side === "buy") {
            buyQty = buyQty.add(effectiveQuantity);
            buyCost = buyCost.add(
              effectiveEntryPrice.mul(CENTAVOS_PER_REAL).mul(effectiveQuantity),
            );
          } else {
            sellQty = sellQty.add(effectiveQuantity);
            sellProceeds = sellProceeds.add(
              effectiveEntryPrice.mul(CENTAVOS_PER_REAL).mul(effectiveQuantity),
            );
          }
          continue;
        }

        const settled = settleLeg(
          leg,
          legIndex,
          op.underlying,
          parseDecimal(underlyingClose),
          session.date,
          session.close,
          view,
        );
        if (!settled.ok) return { ok: false, error: settled.error };
        if (settled.adjustment === "derived") anyStrikeDerived = true;
        if (settled.adjustment === "unconfirmed") anyStrikeUnconfirmed = true;

        // Every option leg folds its own premium into pnl the same way whether it expires
        // worthless or is exercised/assigned: the intrinsic value it carries shows up
        // entirely in the stock trade the exercise/assignment produces, never twice (ADR-0014
        // "Taxes", extended here to the operation's own pnl). Rebased the same way every other
        // leg is: the total premium this collapses to (`effectiveEntryPrice *
        // effectiveQuantity`) always equals `leg.entryPrice * leg.quantity`, the real cash this
        // leg's entry actually paid or received, regardless of `splitFactor`.
        const effectiveEntryPrice = parseDecimal(leg.entryPrice).mul(splitFactor);
        const effectiveQuantity = new Decimal(leg.quantity).div(splitFactor);
        const legPremiumPnl = new Decimal(leg.side === "buy" ? 1 : -1)
          .mul(effectiveEntryPrice)
          .mul(CENTAVOS_PER_REAL)
          .mul(effectiveQuantity)
          .neg();
        optionsPnl = optionsPnl.add(legPremiumPnl);

        if (settled.value.fills.length === 0) {
          worthlessOptionPnl = worthlessOptionPnl.add(legPremiumPnl);
          settlement.push(settled.value);
          continue;
        }

        // settleLeg's fill is cost-free (a settlement proposal is not a trade, ADR-0013 #25
        // addendum); the run charges its own cost model on it, as it does on every other fill.
        // B3 scales option holdings by the same factor as the underlying: the real,
        // immediate trade only ever moves a whole number of shares, so it is floored the same
        // way a stock leg's own exit is, with any fractional remainder cash-settled right here,
        // at this same strike price, the same way a stock-leg exit's own split residue is
        // (resolvePendingExitFills, ADR-0014 Q51) — an exercise/assignment is a real, immediate
        // trade, never a deferred one like the stock leg's own "kept" bucketing above, so none of
        // its value can wait for this operation's aggregate residual close.
        const bareFill = assertDefined(
          settled.value.fills[0],
          "run-backtest: settleLeg reports a non-worthless outcome with no fill",
        );
        const rebased = rebaseExerciseFillUnits(
          bareFill,
          effectiveQuantity,
          `view.corporateActions (${leg.ticker})`,
        );
        if (!rebased.ok) return { ok: false, error: rebased.error };
        let costs = toCentavos(0);
        if (rebased.value.quantity !== null) {
          const q = rebased.value.quantity;
          costs = fillCosts(config.costModel, bareFill.price, q, "stock");
          const fill: Fill = { ...bareFill, quantity: q, costs };
          settlement.push({
            ...settled.value,
            fills: [fill],
            residualValue: rebased.value.residualValue,
          });
          state.fills.push({ ...fill, operationId: op.id, source: "settlement" });
          settlementCosts = settlementCosts.add(costs);
          const gross = grossCentavos(fill.price, q).round().toNumber();
          state.cash -= (fill.side === "buy" ? 1 : -1) * gross + costs;
          if (fill.side === "sell") state.currentMonthStockSales += gross;
        } else {
          // The effective units floored to zero (a corporate-action factor leaving less than
          // one whole share to trade): the stored artifact must not report a fill that never
          // happened, so the proposed fill `settleLeg` returned is dropped, never carried
          // through as-is.
          settlement.push({
            ...settled.value,
            fills: [],
            residualValue: rebased.value.residualValue,
          });
        }
        if (rebased.value.residualValue !== 0) {
          state.cash += rebased.value.residualValue;
          if (bareFill.side === "sell") {
            state.currentMonthStockSales += Math.abs(rebased.value.residualValue);
          }
        }
        if (bareFill.side === "buy") {
          buyQty = buyQty.add(effectiveQuantity);
          buyCost = buyCost.add(
            parseDecimal(bareFill.price).mul(CENTAVOS_PER_REAL).mul(effectiveQuantity),
          );
        } else {
          sellQty = sellQty.add(effectiveQuantity);
          sellProceeds = sellProceeds.add(
            parseDecimal(bareFill.price).mul(CENTAVOS_PER_REAL).mul(effectiveQuantity),
          );
        }
      }

      if (anyStrikeDerived) {
        state.optionStrikeDerivedAcrossCorporateActionNoted = true;
      }
      if (anyStrikeUnconfirmed) {
        state.optionStrikeUnconfirmedAcrossCorporateActionNoted = true;
      }

      const matchedQty = Decimal.min(buyQty, sellQty);
      const avgBuyPrice = buyQty.gt(0) ? buyCost.div(buyQty) : new Decimal(0);
      const avgSellPrice = sellQty.gt(0) ? sellProceeds.div(sellQty) : new Decimal(0);
      const matchedPnl = matchedQty.mul(avgSellPrice.sub(avgBuyPrice));
      // entryCosts is set for every id in state.openOperations at entry time; the fallback
      // only guards the type, the same pattern every other operation-closing call site uses.
      /* v8 ignore next */
      const entryCosts = state.entryCosts[op.id] ?? op.legs.map(() => toCentavos(0));
      let pnlSoFar = optionsPnl.add(matchedPnl).sub(sumCentavos(entryCosts)).sub(settlementCosts);

      const optionGainSoFarCentavos = worthlessOptionPnl.round().toNumber();
      // A grouping factor that does not divide a stock leg's quantity evenly (Q51) can leave
      // this signed residual with a sub-one-share fraction: truncated toward zero (never
      // rounded, which would silently manufacture or discard up to half a phantom share) into
      // the integer residualQuantity a pending settlement can actually trade next session, and
      // the leftover fraction — never reachable by any real share count — cash-settled right
      // here, at this same expiry session's own close, the same way a stock-leg exit's own
      // split residue is (resolvePendingExitFills, ADR-0014 Q51), rather than rounded away.
      const rawResidualQuantity = buyQty.sub(sellQty);
      const residualQuantity = rawResidualQuantity
        .toDecimalPlaces(0, Decimal.ROUND_DOWN)
        .toNumber();
      const residue = rawResidualQuantity.sub(residualQuantity);
      if (!residue.isZero()) {
        const residueIsLong = residue.isPositive();
        const avgCostPerShare = residueIsLong ? avgBuyPrice : avgSellPrice;
        const residueGross = grossCentavos(underlyingClose, residue.abs());
        pnlSoFar = pnlSoFar.add(
          residueGross.sub(avgCostPerShare.mul(residue.abs())).mul(residueIsLong ? 1 : -1),
        );
        const residueGrossCentavos = residueGross.round().toNumber();
        state.cash += (residueIsLong ? 1 : -1) * residueGrossCentavos;
        if (residueIsLong) state.currentMonthStockSales += residueGrossCentavos;
      }
      // This operation leaves state.openOperations at the end of this function's loop
      // (stillOpen never carries it, its expiry matched session.date): any exit rule still
      // pending for it from an earlier session (a days_before_expiry that never filled on a
      // zero-volume session, say) must be dropped right here, at the same moment, whichever
      // branch below follows — finalizeSettlement already does this for the
      // residualQuantity === 0 branch, but the pendingSettlements branch never ran through
      // finalizeSettlement, so the next session's resolvePendingExitFills found a pending
      // exit whose invariant("...a currently open operation") this op no longer satisfied.
      Reflect.deleteProperty(state.pendingExits, op.id);
      if (residualQuantity === 0) {
        const pnlSoFarCentavos = pnlSoFar.round().toNumber();
        state.currentMonthStockGain += pnlSoFarCentavos - optionGainSoFarCentavos;
        state.currentMonthOptionGain += optionGainSoFarCentavos;
        finalizeSettlement(
          {
            op,
            settlement,
            pnlSoFar: 0,
            optionGainSoFarCentavos: 0,
            residualQuantity: 0,
            residualAvgCostCentavos: toDecimalString(new Decimal(0), RATIO_SCALE),
            expirySession: session.date,
          },
          pnlSoFarCentavos,
          session.date,
          null,
        );
      } else {
        state.pendingSettlements[op.id] = {
          op,
          settlement,
          pnlSoFar: pnlSoFar.round().toNumber(),
          optionGainSoFarCentavos,
          residualQuantity,
          // Full precision, never rounded to a whole centavo here: this is
          // a per-share cost basis (`buyCost.div(buyQty)` or its sell-side equivalent), read
          // back by the residual's own close at resolvePendingSettlementResidualFills or
          // closePeriodEnd, both of which already carry full decimal precision through to
          // op.pnl.
          residualAvgCostCentavos: toDecimalString(
            residualQuantity > 0 ? avgBuyPrice : avgSellPrice,
            RATIO_SCALE,
          ),
          expirySession: session.date,
        };
      }
    }
    state.openOperations = stillOpen;
    return { ok: true, value: undefined };
  }

  // Step 2: tax deduction. A month's own tax, computed the day its last session was seen, is
  // deducted on the next session.
  function deductPendingTax(monthKey: string, i: number): void {
    if (
      state.pendingTaxDeduction !== null &&
      state.pendingTaxDeduction.monthKey === monthKey &&
      isLastSessionOfMonth(periodSessions, i, monthKey)
    ) {
      state.cash -= state.pendingTaxDeduction.tax;
      state.pendingTaxDeduction = null;
    }
  }

  // Step 4b: the run's very last month is finalized and deducted on that same last session,
  // but only after settlement and the period-end residual sweep (both run earlier this same
  // session) have folded their own gain into state.currentMonthStockGain — else a last-session
  // settlement's gain escapes tax entirely.
  function finalizeFinalMonthTax(monthKey: string): void {
    finalizeMonth(monthKey);
    const finalTax = assertDefined(state.taxesFinalized.at(-1), "run-backtest: finalized above");
    state.cash -= finalTax.tax;
  }

  // Step 3a: this session's mark value (cash-independent), computed while state.openOperations
  // and state.pendingSettlements still hold what this same close should value. Split from the
  // equity recording below (step 3b) so a final session can close and tax first while still
  // recording equity against the mark this same close saw before that
  // closing cleared the state it was computed from.
  function computeMarkValue(
    session: TradingSession,
  ): Result<{ markValue: number; hasPendingSettlementResidual: boolean }> {
    let markValue = 0;
    for (const op of state.openOperations) {
      const splitFactor = corporateActionFactorThrough(
        op.underlying,
        op.openedAt,
        session.date,
        session.close,
      );
      for (const leg of op.legs) {
        const markPriceOrNull = lastKnownLegPrice(leg, op.underlying, session.date, session.close);
        if (markPriceOrNull === null) {
          return missingMarkError(
            leg.ticker,
            op.openedAt,
            sortedCalendar,
            session.close,
            leg.role === "stock" ? "stock" : "option",
          );
        }
        const markPrice = markPriceOrNull;
        const sign = leg.side === "buy" ? 1 : -1;
        const effectiveQuantity = new Decimal(leg.quantity).div(splitFactor);
        markValue += sign * grossCentavos(markPrice, effectiveQuantity).round().toNumber();
      }
    }
    // A settlement whose residual stock has not yet been closed (traded away at the next
    // session's open, or swept at period_end) still represents a real position: cash was
    // already debited or credited for the exercise/assignment fill, so the residual itself
    // must be marked here at this same close (I1) or equity silently omits it — the residual
    // is a valuation, not a trade, so no fill or cost is recorded.
    let hasPendingSettlementResidual = false;
    for (const pending of Object.values(state.pendingSettlements)) {
      hasPendingSettlementResidual = true;
      const markPriceOrNull = lastKnownRescaledPrice(
        "stock",
        pending.op.underlying,
        pending.op.underlying,
        session.date,
        session.close,
      );
      if (markPriceOrNull === null) {
        return missingMarkError(
          pending.op.underlying,
          pending.op.openedAt,
          sortedCalendar,
          session.close,
        );
      }
      // The residual itself, like the pending-settlement fill above, is frozen at the expiry
      // session's scale and rebases the same way (Q51) for a split ex-dated since then.
      const residualFactor = corporateActionFactorThrough(
        pending.op.underlying,
        pending.expirySession,
        session.date,
        session.close,
      );
      const effectiveResidualQuantity = new Decimal(pending.residualQuantity).div(residualFactor);
      markValue += grossCentavos(markPriceOrNull, effectiveResidualQuantity).round().toNumber();
    }
    return { ok: true, value: { markValue, hasPendingSettlementResidual } };
  }

  // Step 3b: records this session's equity point against the current state.cash — for every
  // session but the last, that is the cash before this session's next signals are queued; for
  // the last, closePeriodEnd and finalizeFinalMonthTax have already run, so this is cash after
  // that same session's own tax is deducted, against the mark step 3a took before either ran
  // (an equity point recorded before the final tax deduction would
  // silently omit it, since there is no later session to correct it on).
  function recordEquityPoint(
    session: TradingSession,
    markValue: number,
    hasPendingSettlementResidual: boolean,
  ): Centavos {
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
    state.held.push(state.openOperations.length > 0 || hasPendingSettlementResidual);
    state.rfPerSession.push(rfAt(session.close));
    state.hasCandle.push(
      config.universe.some(
        (ticker) => candleFor(candlesByTicker, ticker, session.date, session.close) !== null,
      ),
    );
    return equity;
  }

  // ADR-0041: the leading run of period sessions where every universe instrument's own
  // evaluation was "insufficient_data" is warm-up, not a tradable window; firstTradableSession
  // fixes the boundary the first time any instrument's evaluation reaches a real outcome, and
  // stays fixed for the rest of the run (including a resumed chunk, since it is checkpointed).
  function noteFirstTradableSession(
    session: TradingSession,
    evaluations: readonly { outcome: EvaluationOutcome }[],
  ): void {
    if (state.firstTradableSession !== null) return;
    if (evaluations.length === 0) return;
    if (evaluations.every((e) => e.outcome === "insufficient_data")) return;
    state.firstTradableSession = session.date;
  }

  // Issue #269: an exit-rule base's or an exit-rule current-side pricing's own per-leg strike
  // adjustment (evaluate-strategy.ts's `computeExitRuleBases`/`evaluateNumericExitRule`, both
  // already priced through `priceLegsAt`) — and, below, an accepted entry proposal's own per-leg
  // strike adjustment — rolls into the same two run-wide flags the settlement path below already
  // sets, rather than a second pair of flags or a second note on the run — the run only needs to
  // know a strike was ever derived or left unconfirmed somewhere in its life, not which caller
  // first noticed it.
  function rollExitRuleStrikeNotes(notes: readonly Note[]): void {
    for (const note of notes) {
      if (note.code === OPTION_STRIKE_DERIVED_NOTE.code) {
        state.optionStrikeDerivedAcrossCorporateActionNoted = true;
      }
      if (note.code === OPTION_STRIKE_UNCONFIRMED_NOTE.code) {
        state.optionStrikeUnconfirmedAcrossCorporateActionNoted = true;
      }
    }
  }

  // Step 4: period end sweep — closes every still-open operation at its own mark, marks (never
  // trades) any pending settlement's residual, and finalizes stranded pending entries. Computes
  // its own marks (rather than reusing markOpenOperations's marksThisSession) precisely so it can
  // run — and fold its gain into state.currentMonthStockGain — before this same final session's
  // equity is computed and its month's tax is finalized: running it after equity, as an
  // earlier version did, either misses the residual mark or lets
  // a last-session settlement's gain escape tax.
  function closePeriodEnd(session: TradingSession, failedEntryTickers: Set<Ticker>): Result<void> {
    for (const op of state.openOperations) {
      const entryCosts = state.entryCosts[op.id] ?? op.legs.map(() => toCentavos(0));
      const splitFactor = corporateActionFactorThrough(
        op.underlying,
        op.openedAt,
        session.date,
        session.close,
      );
      let pnl = new Decimal(0);
      for (let legIndex = 0; legIndex < op.legs.length; legIndex += 1) {
        const leg = assertDefined(op.legs[legIndex], "run-backtest: legIndex within bounds");
        const price = lastKnownLegPrice(leg, op.underlying, session.date, session.close);
        // computeMarkValue already read this exact leg at this exact session (same op.legs,
        // untouched since, same deterministic lastKnownLegPrice) moments earlier in the same loop
        // iteration, before this final-session branch runs at all: a null here would already
        // have returned from that earlier call, so this can never be reached.
        /* v8 ignore start */
        if (price === null) {
          return missingMarkError(
            leg.ticker,
            op.openedAt,
            sortedCalendar,
            session.close,
            leg.role === "stock" ? "stock" : "option",
          );
        }
        /* v8 ignore stop */
        const entryCost = entryCosts[legIndex] ?? toCentavos(0);
        pnl = pnl.add(legPnlCentavos(leg, price, splitFactor)).sub(entryCost);
      }
      state.operations.push({
        id: op.id,
        underlying: op.underlying,
        legs: op.legs,
        expiry: op.expiry,
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
    // A residual still open when the period ends has no next session to close it at: it
    // is marked at this same close instead, under the period_end rule (ADR-0013
    // "Settlement in a run").
    for (const [opId, pending] of Object.entries(state.pendingSettlements)) {
      const markPrice = lastKnownRescaledPrice(
        "stock",
        pending.op.underlying,
        pending.op.underlying,
        session.date,
        session.close,
      );
      // lastKnownRescaledPrice only requires a candle at or before this session; the settlement
      // that produced this pending residual already found one, on or before its own
      // (earlier or equal) expiry session, so this same lookup at this later session can
      // never come back empty — the earlier candle stays "last known" forever after.
      /* v8 ignore start */
      if (markPrice === null) {
        return missingMarkError(
          pending.op.underlying,
          pending.op.openedAt,
          sortedCalendar,
          session.close,
        );
      }
      /* v8 ignore stop */
      // Frozen at the expiry session's scale, like the pending-settlement fill and mark above;
      // rebases the same way (Q51) for a split ex-dated since then.
      const residualFactor = corporateActionFactorThrough(
        pending.op.underlying,
        pending.expirySession,
        session.date,
        session.close,
      );
      const effectiveResidualQuantity = new Decimal(pending.residualQuantity).div(residualFactor);
      const effectiveResidualAvgCostCentavos = new Decimal(pending.residualAvgCostCentavos).mul(
        residualFactor,
      );
      const residualPnl = parseDecimal(markPrice)
        .sub(effectiveResidualAvgCostCentavos.div(CENTAVOS_PER_REAL))
        .mul(effectiveResidualQuantity.isNeg() ? -1 : 1)
        .mul(CENTAVOS_PER_REAL)
        .mul(effectiveResidualQuantity.abs())
        .add(pending.pnlSoFar)
        .round()
        .toNumber();
      // Only pnlSoFar is a real, already-filled trade (the settlement's exercise or
      // assignment); the residual's own mark here is a valuation, not a trade, and is not
      // a taxable event (ADR-0013 "Simulated operations", the same rule a period_end
      // close already follows for a stock-only run). Split the same way the deferred
      // residual-close fold above does: the worthless-leg slice is
      // optionGain, the rest (matched netting, an exercised/assigned leg's own premium)
      // is stockGain.
      state.currentMonthStockGain += pending.pnlSoFar - pending.optionGainSoFarCentavos;
      state.currentMonthOptionGain += pending.optionGainSoFarCentavos;
      finalizeSettlement(pending, residualPnl, pending.expirySession, "period_end");
      Reflect.deleteProperty(state.pendingSettlements, opId);
    }
    const strandedEntryTickers = new Set<Ticker>([
      ...Object.keys(state.pendingEntries),
      ...failedEntryTickers,
    ]);
    for (const ticker of strandedEntryTickers) {
      finalizeMissedEntry(ticker, session.close, "no_trades");
    }
    state.pendingExits = {};
    return { ok: true, value: undefined };
  }

  const evaluate = createStrategyEvaluator({
    view,
    strategy: {
      ...config.strategy,
      definition: {
        ...config.strategy.definition,
        sizing: config.sizing ?? config.strategy.definition.sizing,
      },
    },
    instruments: config.universe,
  });

  // Step 5: evaluates the strategy for the next signals and queues them (every session but the
  // last, which closePeriodEnd handles instead).
  function queueNextSignals(
    session: TradingSession,
    equity: Centavos,
    failedEntryTickers: Set<Ticker>,
  ): Result<void> {
    if (equity <= 0) state.equityClampEngaged = true;
    const currentEquity = Math.max(equity, 1);
    const evalResult = evaluate({
      at: session.close,
      openOperations: state.openOperations,
      riskProfile: {
        declaredCapital: toCentavos(currentEquity),
        limits: config.riskProfile.limits,
      },
    });
    if (!evalResult.ok) return { ok: false, error: evalResult.error };
    noteFirstTradableSession(session, evalResult.value.evaluations);
    rollExitRuleStrikeNotes(evalResult.value.notes);

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
        // Rolled up here, on acceptance into a pending entry (queued into state.pendingEntries
        // right below) — not on an actual fill, which `resolvePendingEntryFills` only resolves a
        // session later. A limit-breached proposal never reaches this line at all (refused above,
        // before ever being priced into anything the run goes on to hold), but a proposal that
        // does clear that gate still rolls its note up here even if it is queued, retried and
        // finally abandoned (`finalizeMissedEntry("no_trades")`, once retryCount reaches 3) without
        // ever filling: deliberately conservative, since the earlier attempts that queued it were
        // priced on the same derived/unconfirmed strike, and over-warning on an attempt that never
        // filled is safer than risking a silent drop on one that did (issue #269).
        rollExitRuleStrikeNotes(strikeAdjustmentNotesOf(signal.proposal.pricing.legs));
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
    return { ok: true, value: undefined };
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
    const residualFillsResult = resolvePendingSettlementResidualFills(session);
    if (!residualFillsResult.ok) return { ok: false, error: residualFillsResult.error };
    deductPendingTax(monthKey, i);

    const expiringResult = resolveExpiringOperations(session);
    if (!expiringResult.ok) return { ok: false, error: expiringResult.error };

    // computeMarkValue always runs first, while state.openOperations and
    // state.pendingSettlements still hold what this session's close should value (equity is
    // the mark of the position, not the result of closing it): closePeriodEnd only clears
    // them afterward, which is also when its own settlement gain lands in
    // state.currentMonthStockGain, before this same final session's own month is finalized (or
    // that gain would escape tax entirely) — and recordEquityPoint runs
    // last of all on a final session, against the mark this step took but the cash finalized tax
    // already deducted, or the equity curve would silently omit that same deduction.
    const markResult = computeMarkValue(session);
    if (!markResult.ok) return { ok: false, error: markResult.error };

    if (isFinalSession) {
      const closed = closePeriodEnd(session, failedEntryTickers);
      if (!closed.ok) return { ok: false, error: closed.error };
      finalizeFinalMonthTax(monthKey);
      const finalEquity = recordEquityPoint(
        session,
        markResult.value.markValue,
        markResult.value.hasPendingSettlementResidual,
      );
      // No signal is ever queued on the final session (there is no next session to fill it),
      // but a run that never left warm-up before now still needs this session's own evaluation
      // to learn whether it, at least, was tradable (ADR-0041) — skipped once
      // firstTradableSession is already known, the common case, so this never doubles the
      // per-session evaluate() cost of an ordinary run.
      if (state.firstTradableSession === null) {
        const finalEval = evaluate({
          at: session.close,
          openOperations: state.openOperations,
          riskProfile: {
            declaredCapital: toCentavos(Math.max(finalEquity, 1)),
            limits: config.riskProfile.limits,
          },
        });
        if (!finalEval.ok) return { ok: false, error: finalEval.error };
        noteFirstTradableSession(session, finalEval.value.evaluations);
        rollExitRuleStrikeNotes(finalEval.value.notes);
      }
      continue;
    }

    const equity = recordEquityPoint(
      session,
      markResult.value.markValue,
      markResult.value.hasPendingSettlementResidual,
    );
    const next = queueNextSignals(session, equity, failedEntryTickers);
    if (!next.ok) return { ok: false, error: next.error };
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

  const { observed, postWarmup, warmupCount, candleLessCount } = observedSessions(state);
  const { metrics, notes: metricsNotes } = computeBacktestMetrics(
    buildMetricsInput(state, config.initialCapital, observed, postWarmup),
  );
  const notes = [...metricsNotes];
  if (warmupCount > 0) {
    notes.push({
      code: "warm_up_sessions_excluded",
      message:
        state.firstTradableSession === null
          ? `all ${String(warmupCount)} session(s) in the run fell inside the warm-up window; the strategy never had enough history to evaluate`
          : `${String(warmupCount)} leading session(s) excluded from metrics: the strategy lacked enough history to evaluate; first tradable session ${state.firstTradableSession}`,
    });
  }
  if (candleLessCount > 0) {
    notes.push({
      code: "candle_less_sessions_excluded",
      message: `${String(candleLessCount)} session(s) excluded from sessions, sharpe and exposure: no universe ticker had a candle that session (still counted in cagr's elapsed clock and in maxDrawdown/totalReturn, ADR-0041)`,
    });
  }
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
  // the shared `notes.ts` constants, not a third independent
  // wording of the same two codes (score.ts and propose-settlement.ts each already emit these
  // exact objects; run-backtest.ts rolls at least one leg-level occurrence up to the run as a
  // whole, ADR-0013's deferred roll-up, issue #269).
  if (state.optionStrikeDerivedAcrossCorporateActionNoted) notes.push(OPTION_STRIKE_DERIVED_NOTE);
  if (state.optionStrikeUnconfirmedAcrossCorporateActionNoted) {
    notes.push(OPTION_STRIKE_UNCONFIRMED_NOTE);
  }
  if (state.stalePriceRescaledAcrossCorporateActionNoted) {
    notes.push(STALE_MARK_RESCALED_ACROSS_CORPORATE_ACTION_NOTE);
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
    walkForward: config.walkForward
      ? computeWalkForward({
          windowSessions: config.walkForward.windowSessions,
          periodSessions: periodSessions.map((s) => s.date),
          initialCapital: config.initialCapital,
          equityCurve: state.equityCurve,
          rfPerSession: state.rfPerSession,
          held: state.held,
          observed,
          postWarmup,
          operations: state.operations,
          fills: state.fills,
          taxes: state.taxesFinalized,
          slippageEntries: state.slippageEntries,
        })
      : null,
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

// ADR-0041: a session is in the warm-up prefix when it falls strictly before
// firstTradableSession, or when firstTradableSession never resolved (the strategy could not
// evaluate for the whole run); it is post-warm-up (and observed, additionally, when it also
// carries a universe candle) otherwise. `inWarmup` gates both return values below, so the
// warm-up and candle-less exclusions are mutually exclusive by construction: a warm-up
// session's own candle-less-ness, if any, is folded into the warm-up count rather than
// double-counted as a gap, regardless of what the caller's own period bounds guarantee.
function observedSessions(state: BacktestState): {
  observed: boolean[];
  postWarmup: boolean[];
  warmupCount: number;
  candleLessCount: number;
} {
  const firstTradable = state.firstTradableSession;
  let warmupCount = 0;
  let candleLessCount = 0;
  const postWarmup: boolean[] = [];
  const observed = state.equityCurve.map((point, i) => {
    const inWarmup = firstTradable === null || point.session < firstTradable;
    postWarmup.push(!inWarmup);
    if (inWarmup) {
      warmupCount += 1;
      return false;
    }
    const hasCandle = state.hasCandle[i] ?? false;
    if (!hasCandle) candleLessCount += 1;
    return hasCandle;
  });
  return { observed, postWarmup, warmupCount, candleLessCount };
}

function buildMetricsInput(
  state: BacktestState,
  initialCapital: Centavos,
  observed: readonly boolean[],
  postWarmup: readonly boolean[],
): MetricsInput {
  const settled = state.operations.filter(isSettledOperation);
  return {
    equityCurve: state.equityCurve,
    initialCapital,
    rfPerSession: state.rfPerSession,
    held: state.held,
    observed,
    postWarmup,
    settledOperationPnls: settled.map((op) => op.pnl),
    operationsCount: state.operations.length,
    fees: sumCentavos(state.fills.map((f) => f.costs)),
    taxes: sumCentavos(state.taxesFinalized.map((t) => t.tax)),
    slippage: sumCentavos(state.slippageEntries.map((s) => s.amount)),
  };
}
