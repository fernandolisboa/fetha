import {
  confidenceSchema,
  instantSchema,
  type Confidence,
  type DecimalString,
  type Instant,
  type Structure,
  type Ticker,
} from "@fetha/contracts";
import {
  decisionKinds,
  engine,
  type Operation,
  type OperationLeg,
  type ScoreInput,
} from "@fetha/engine";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import {
  buildOperationMarketView,
  expiryByTicker,
  tradingSessionOnOrAfter,
} from "@/modules/market-data";
import { StrategiesRepository } from "@/modules/strategies";

import type { DueDecisionRow } from "./decision-scores-repository";
import {
  decisionInputsSchema,
  type OperationDecisionInputs,
  type SignalDecisionInputs,
} from "./inputs";

export type BuildScoreInputResult = { ok: true; input: ScoreInput } | { ok: false; reason: string };

const DECISION_KIND_VALUES = new Set<string>(decisionKinds);

export class MissingEntryPriceError extends Error {
  constructor(ticker: string) {
    super(`no snapshotted entry price for leg ${ticker}`);
    this.name = "MissingEntryPriceError";
  }
}

export class MismatchedExpiryError extends Error {
  constructor() {
    super("operation legs do not share a single expiry (ADR-0014 Q43)");
    this.name = "MismatchedExpiryError";
  }
}

// The engine has no real portfolio to read fills from yet (#26): every
// `Operation` this builds is a decision-time reconstruction from the
// decision's own snapshot, not a fill history, so it needs a stable id of
// its own that is never mistaken for a real operation's id.
function syntheticOperationId(decisionId: string): string {
  return `decision-score:${decisionId}`;
}

function matchEntryPrice(
  ticker: Ticker,
  index: number,
  pricingLegs: { ticker: Ticker; price: DecimalString | null }[],
): DecimalString | null {
  const byIndex = pricingLegs[index];
  if (byIndex && byIndex.ticker === ticker) {
    return byIndex.price;
  }
  return pricingLegs.find((entry) => entry.ticker === ticker)?.price ?? null;
}

type ResolveExpiryResult = { ok: true; expiry: string | null } | { ok: false };

// ADR-0014 Q43: every option leg of a structure shares one expiry. Asserted
// here, not assumed (#29 fix-web item 11): a chain rollover or a data gap
// that leaves two of an operation's own legs pointing at different expiries
// is a build failure (`mismatched_expiry`), not a silent pick of "the first
// leg's expiry" the way `deriveDefaultHorizon` (horizon.ts) gets away with
// for a fresh structure that has never rolled.
async function resolveExpiry(
  db: Database,
  legs: { ticker: Ticker; role: string }[],
): Promise<ResolveExpiryResult> {
  const optionTickers = legs.filter((leg) => leg.role !== "stock").map((leg) => leg.ticker);
  if (optionTickers.length === 0) {
    return { ok: true, expiry: null };
  }
  const expiries = await expiryByTicker(db, optionTickers);
  const resolved = optionTickers.map((ticker) => expiries.get(ticker) ?? null);
  const distinctExpiries = new Set(resolved);
  if (distinctExpiries.size > 1) {
    return { ok: false };
  }
  return { ok: true, expiry: resolved[0] ?? null };
}

// Builds the `Operation` a signal-entry decision was taken on, from the
// snapshotted `proposal.legs` and the proposal's own per-leg prices as
// `entryPrice` (brief item 3). A proposal with no legs, or a decision whose
// signal carried no proposal at all (exit/hold), yields no operation — the
// decision is scored thesis-only (Q46).
async function operationFromSignalInputs(
  db: Database,
  decisionId: string,
  strategyVersionId: string | null,
  inputs: SignalDecisionInputs,
): Promise<Operation | null> {
  const proposal = inputs.proposal;
  if (!proposal || proposal.legs.length === 0) {
    return null;
  }
  const pricingLegs = proposal.pricing.legs.map((legValuation) => ({
    ticker: legValuation.leg.ticker,
    price: legValuation.price,
  }));
  const legs: OperationLeg[] = proposal.legs.map((leg, index) => {
    const entryPrice = matchEntryPrice(leg.ticker, index, pricingLegs);
    if (entryPrice === null) {
      throw new MissingEntryPriceError(leg.ticker);
    }
    return { ...leg, entryPrice };
  });
  const resolvedExpiry = await resolveExpiry(db, legs);
  if (!resolvedExpiry.ok) {
    throw new MismatchedExpiryError();
  }
  return {
    id: syntheticOperationId(decisionId),
    underlying: inputs.ticker,
    legs,
    expiry: resolvedExpiry.expiry,
    openedAt: inputs.session,
    strategyVersionId,
    rolledFrom: null,
  };
}

// Builds the `Operation` a contemplated-operation decision was taken on.
// `contemplated_operations` snapshots only carry the leg roster
// (`OperationDecisionInputs.legs`), not a per-leg entry price, so the legs
// are re-priced deterministically with `engine.priceOperation` on a market
// view truncated at `decidedAt` — the same call `priceOperationLegs`
// (apps/web's builder, `portfolio/engine-client.ts`) made when the user saw
// this operation, replayed at the decision's own instant instead of "now".
// Returns `null` when pricing fails or a leg comes back with no price; the
// caller decides whether that is an acceptable thesis-only fallback or a
// hard failure, based on the decision's claim.
async function operationFromContemplatedInputs(
  db: Database,
  decisionId: string,
  decidedAt: Instant,
  inputs: OperationDecisionInputs,
): Promise<Operation | null> {
  if (inputs.legs.length === 0) {
    return null;
  }
  const view = await buildOperationMarketView(db, inputs.underlying, decidedAt);
  const pricing = await engine.priceOperation({
    view,
    at: decidedAt,
    legs: inputs.legs.map((leg) => ({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: leg.quantity,
    })),
    openOperationCount: 0,
  });
  if (!pricing.ok) {
    return null;
  }
  const pricingLegs = pricing.value.legs.map((legValuation) => ({
    ticker: legValuation.leg.ticker,
    price: legValuation.price,
  }));
  const legs: OperationLeg[] = [];
  for (const [index, leg] of inputs.legs.entries()) {
    const entryPrice = matchEntryPrice(leg.ticker, index, pricingLegs);
    if (entryPrice === null) {
      return null;
    }
    legs.push({ ...leg, entryPrice });
  }
  const resolvedExpiry = await resolveExpiry(db, legs);
  if (!resolvedExpiry.ok) {
    throw new MismatchedExpiryError();
  }
  return {
    id: syntheticOperationId(decisionId),
    underlying: inputs.underlying,
    legs,
    expiry: resolvedExpiry.expiry,
    openedAt: inputs.session,
    strategyVersionId: null,
    rolledFrom: null,
  };
}

// Builds the `ScoreInput` the engine's `score` takes for one due decision
// (brief item 3). Returns `{ ok: false }` with a reason instead of throwing
// for every gap that means "cannot score this decision yet" (a strategy
// version that no longer resolves, a horizon session the calendar does not
// know, a snapshotted proposal with no price for one of its legs) so the
// caller can record it and move on — the same shape
// `evaluateSignalsForSession` uses for `unknown_structure` and
// `market_view_too_large`.
export async function buildScoreInput(
  db: Database,
  scopedUser: ScopedUser,
  row: DueDecisionRow,
  // Resolved once per scoring run and passed in, not re-fetched per decision
  // (#29 fix-web item 11, architecture advisory): the structure catalog is
  // shared reference data (ADR-0012) that never changes mid-run, so every
  // decision in a run reuses the same in-memory list `scoreDueDecisions`
  // loaded once instead of a `StructuresRepository.listAll()` query each.
  structures: readonly Structure[],
): Promise<BuildScoreInputResult> {
  if (!DECISION_KIND_VALUES.has(row.kind)) {
    return { ok: false, reason: "unknown_decision_kind" };
  }
  // A decision row whose stored `inputs`/`decidedAt` no longer parse (a shape an older app
  // version wrote, corrupted or hand-edited data) can never be fixed by retrying tomorrow night
  // (round 3 item 5): returned as a build failure like every other gap here, not thrown, so the
  // caller's generic per-decision catch (which never marks a row unscorable, to keep retrying
  // a transient failure) does not retry an error no future data will resolve.
  let inputs: OperationDecisionInputs | SignalDecisionInputs;
  let decidedAt: Instant;
  try {
    inputs = decisionInputsSchema.parse(row.inputs);
    decidedAt = instantSchema.parse(row.decidedAt.toISOString());
  } catch {
    return { ok: false, reason: "invalid_inputs" };
  }

  let operation: Operation | null = null;
  let origin: ScoreInput["origin"] = { kind: "manual" };

  if (inputs.originKind === "signal") {
    try {
      operation = await operationFromSignalInputs(db, row.id, row.strategyVersionId, inputs);
    } catch (error) {
      if (error instanceof MissingEntryPriceError) {
        return { ok: false, reason: "missing_entry_price" };
      }
      if (error instanceof MismatchedExpiryError) {
        return { ok: false, reason: "mismatched_expiry" };
      }
      throw error;
    }

    if (row.strategyVersionId) {
      const strategiesRepository = new StrategiesRepository(db, scopedUser);
      const version = await strategiesRepository.findVersionForScoring(row.strategyVersionId);
      if (!version) {
        return { ok: false, reason: "missing_strategy_version" };
      }
      const structure = structures.find(
        (candidate) => candidate.id === version.definition.structureId,
      );
      if (!structure) {
        return { ok: false, reason: "unknown_structure" };
      }
      origin = {
        kind: "signal",
        strategy: { id: version.id, definition: version.definition, structure },
      };
    }
  } else {
    // Contemplated-operation origin: `origin` stays `manual` (there is no
    // strategy behind a hand-built operation), but the `Operation` itself
    // is reconstructed by re-pricing the snapshotted legs — see
    // `operationFromContemplatedInputs`. `operation_pnl_positive` is the
    // only claim that needs the operation to score at all (it drives P&L
    // and the counterfactual); every other claim is fine thesis-only when
    // re-pricing comes back empty.
    try {
      operation = await operationFromContemplatedInputs(db, row.id, decidedAt, inputs);
    } catch (error) {
      if (error instanceof MismatchedExpiryError) {
        return { ok: false, reason: "mismatched_expiry" };
      }
      throw error;
    }
    if (!operation && row.claim?.kind === "operation_pnl_positive") {
      return { ok: false, reason: "missing_entry_price" };
    }
  }

  const underlying = inputs.originKind === "signal" ? inputs.ticker : inputs.underlying;
  const claimInstrument =
    row.claim && row.claim.kind !== "operation_pnl_positive" ? row.claim.instrument : undefined;

  // Resolved to the first trading session on or after the stored horizon
  // (#29 fix-web item 5): a horizon a user typed in can land on a weekend or
  // a holiday, and the claim/operation can only ever be evaluated against
  // the next session that actually trades.
  const horizonTradingSession = await tradingSessionOnOrAfter(db, row.horizon);
  if (!horizonTradingSession) {
    return { ok: false, reason: "unresolvable_horizon_session" };
  }

  const view = await buildOperationMarketView(db, underlying, horizonTradingSession.close, {
    // Widened to cover `decidedAt` (#29 fix-web item 4): the default
    // 30-session trailing floor otherwise drops it for any horizon more
    // than 30 sessions out.
    from: decidedAt,
    extraInstruments: claimInstrument && claimInstrument !== underlying ? [claimInstrument] : [],
  });

  let confidence: Confidence;
  try {
    confidence = confidenceSchema.parse(row.confidence);
  } catch {
    return { ok: false, reason: "invalid_inputs" };
  }

  const scoreInput: ScoreInput = {
    view,
    subject: row.kind as ScoreInput["subject"],
    decidedAt,
    horizon: horizonTradingSession.date,
    confidence,
    claim: row.claim,
    ...(operation ? { operation } : {}),
    realizedFills: [],
    origin,
    costModel: row.costModel,
  };

  return { ok: true, input: scoreInput };
}
