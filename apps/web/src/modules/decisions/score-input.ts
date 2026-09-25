import {
  confidenceSchema,
  instantSchema,
  type Confidence,
  type DecimalString,
  type Instant,
  type Ticker,
} from "@fetha/contracts";
import { decisionKinds, type Operation, type OperationLeg, type ScoreInput } from "@fetha/engine";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import {
  buildOperationMarketView,
  expiryByTicker,
  tradingSessionForDate,
} from "@/modules/market-data";
import { StrategiesRepository, StructuresRepository } from "@/modules/strategies";

import type { DueDecisionRow } from "./decision-scores-repository";
import { decisionInputsSchema, type SignalDecisionInputs } from "./inputs";

export type BuildScoreInputResult = { ok: true; input: ScoreInput } | { ok: false; reason: string };

const DECISION_KIND_VALUES = new Set<string>(decisionKinds);

export class MissingEntryPriceError extends Error {
  constructor(ticker: string) {
    super(`no snapshotted entry price for leg ${ticker}`);
    this.name = "MissingEntryPriceError";
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

async function resolveExpiry(
  db: Database,
  legs: { ticker: Ticker; role: string }[],
): Promise<string | null> {
  const optionTickers = legs.filter((leg) => leg.role !== "stock").map((leg) => leg.ticker);
  if (optionTickers.length === 0) {
    return null;
  }
  const expiries = await expiryByTicker(db, optionTickers);
  return expiries.get(optionTickers[0] as string) ?? null;
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
  const expiry = await resolveExpiry(db, legs);
  return {
    id: syntheticOperationId(decisionId),
    underlying: inputs.ticker,
    legs,
    expiry,
    openedAt: inputs.session,
    strategyVersionId,
    rolledFrom: null,
  };
}

async function buildScoreMarketView(
  db: Database,
  underlying: Ticker,
  claimInstrument: Ticker | undefined,
  at: Instant,
) {
  const primary = await buildOperationMarketView(db, underlying, at);
  if (!claimInstrument || claimInstrument === underlying) {
    return primary;
  }
  const claimView = await buildOperationMarketView(db, claimInstrument, at);
  return { ...primary, candles: [...primary.candles, ...claimView.candles] };
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
): Promise<BuildScoreInputResult> {
  if (!DECISION_KIND_VALUES.has(row.kind)) {
    return { ok: false, reason: "unknown_decision_kind" };
  }
  const inputs = decisionInputsSchema.parse(row.inputs);

  let operation: Operation | null = null;
  let origin: ScoreInput["origin"] = { kind: "manual" };

  if (inputs.originKind === "signal") {
    try {
      operation = await operationFromSignalInputs(db, row.id, row.strategyVersionId, inputs);
    } catch (error) {
      if (error instanceof MissingEntryPriceError) {
        return { ok: false, reason: "missing_entry_price" };
      }
      throw error;
    }

    if (row.strategyVersionId) {
      const strategiesRepository = new StrategiesRepository(db, scopedUser);
      const version = await strategiesRepository.findVersionForScoring(row.strategyVersionId);
      if (!version) {
        return { ok: false, reason: "missing_strategy_version" };
      }
      const structures = await new StructuresRepository(db).listAll();
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
  }
  // Contemplated-operation origin (brief limitation, reported in the PR
  // notes): `contemplated_operations` snapshots only aggregate pricing
  // (`net_premium_centavos`, `max_loss_centavos`, `max_gain_centavos`), not
  // a per-leg entry price, so an `OperationLeg.entryPrice` cannot be
  // reconstructed here without inventing a price the decision was never
  // actually taken at. Scored thesis-only until a per-leg snapshot exists —
  // `operation` and `origin` both stay at their `null`/`manual` default for
  // this origin.

  const underlying = inputs.originKind === "signal" ? inputs.ticker : inputs.underlying;
  const claimInstrument =
    row.claim && row.claim.kind !== "operation_pnl_positive" ? row.claim.instrument : undefined;

  const horizonSession = row.horizon;
  const horizonTradingSession = await tradingSessionForDate(db, horizonSession);
  if (!horizonTradingSession) {
    return { ok: false, reason: "unresolvable_horizon_session" };
  }

  const view = await buildScoreMarketView(
    db,
    underlying,
    claimInstrument,
    horizonTradingSession.close,
  );

  const confidence: Confidence = confidenceSchema.parse(row.confidence);

  const scoreInput: ScoreInput = {
    view,
    subject: row.kind as ScoreInput["subject"],
    decidedAt: instantSchema.parse(row.decidedAt.toISOString()),
    horizon: horizonSession,
    confidence,
    claim: row.claim,
    ...(operation ? { operation } : {}),
    realizedFills: [],
    origin,
    costModel: row.costModel,
  };

  return { ok: true, input: scoreInput };
}
