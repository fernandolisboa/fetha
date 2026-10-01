import type { SessionDate, Ticker } from "@fetha/contracts";
import type { CorporateActionFactor, Operation, OperationLeg, OptionRight } from "@fetha/engine";

import { holdingKey, operationLegs, type LedgerFill } from "./bookkeeping";
import { normalizeFillsForOperationBasis } from "./corporate-action-basis";
import type { OperationStatus } from "./schema";

export interface SeriesFacts {
  underlying: Ticker;
  right: OptionRight;
  strike: string;
  expiry: SessionDate;
}

// Keyed by `holdingKey(ticker, expiry)`: the facts of every option series
// the fills being grouped traded.
export type SeriesByHolding = ReadonlyMap<string, SeriesFacts>;

export type GroupRefusal = "empty" | "unknown_series" | "mixed_underlyings" | "mixed_expiries";

export interface OperationState {
  underlying: Ticker;
  expiry: SessionDate | null;
  openedAt: SessionDate;
  status: Exclude<OperationStatus, "expired">;
  closedAt: SessionDate | null;
  legs: OperationLeg[];
  // #271: at least one fill's corporate-action rebase (broker-recorded quantity converted back
  // to the operation's own `openedAt` basis) did not land on a whole share; every fill was kept
  // exactly as recorded instead, so this operation's legs may not reflect the corporate action.
  corporateActionNormalizationSkipped?: boolean;
}

export type OperationPlan =
  { ok: true; state: OperationState } | { ok: false; reason: GroupRefusal };

// ADR-0021 item 4: one underlying, one shared expiry (ADR-0014 Q43), every
// option series known; open while any leg is non-zero.
export function planOperation(
  fills: readonly LedgerFill[],
  series: SeriesByHolding,
  corporateActions: readonly CorporateActionFactor[] = [],
): OperationPlan {
  if (fills.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const underlyings = new Set<Ticker>();
  const expiries = new Set<SessionDate>();
  for (const fill of fills) {
    if (fill.assetClass === "stock") {
      underlyings.add(fill.ticker);
      continue;
    }
    const facts = fill.expiry ? series.get(holdingKey(fill.ticker, fill.expiry)) : undefined;
    if (!facts) {
      return { ok: false, reason: "unknown_series" };
    }
    underlyings.add(facts.underlying);
    expiries.add(facts.expiry);
  }
  if (underlyings.size !== 1) {
    return { ok: false, reason: "mixed_underlyings" };
  }
  if (expiries.size > 1) {
    return { ok: false, reason: "mixed_expiries" };
  }

  const [underlying] = underlyings;
  const [expiry = null] = expiries;
  const sessions = fills.map((fill) => fill.session).sort();
  const [openedAt] = sessions;
  const lastSession = sessions.at(-1);
  if (!underlying || !openedAt || !lastSession) {
    return { ok: false, reason: "empty" };
  }

  // #271: "each fill is recorded as the broker showed it on its own date." Every fill is put on
  // the operation's own `openedAt` basis before it is netted into legs, so a fill entered
  // post-split nets correctly against one entered pre-split; the engine's own forward rebase
  // (ADR-0014 Q51) then reproduces the real, current quantity from that nominal basis.
  const normalized = normalizeFillsForOperationBasis(fills, openedAt, corporateActions);
  const legs =
    operationLegs(normalized.fills, (holding) =>
      holding.expiry
        ? (series.get(holdingKey(holding.ticker, holding.expiry))?.right ?? null)
        : null,
    ) ?? [];
  const open = legs.length > 0;
  return {
    ok: true,
    state: {
      underlying,
      expiry,
      openedAt,
      status: open ? "open" : "closed",
      closedAt: open ? null : lastSession,
      legs,
      corporateActionNormalizationSkipped: normalized.skipped,
    },
  };
}

// The shared expiry only while an option leg is still open: a stock leg left
// after its options closed keeps the options' expiry in the plan (and in
// `operations.expiry`), but a stock-only operation carries none (ADR-0013
// "Operations, positions and strategy versions", ADR-0022).
export function heldExpiry(state: OperationState): SessionDate | null {
  return state.legs.some((leg) => leg.role !== "stock") ? state.expiry : null;
}

// The engine's `Operation` for an open operation: its non-zero legs and its
// `heldExpiry`.
export function toEngineOperation(id: string, state: OperationState): Operation {
  return {
    id,
    underlying: state.underlying,
    legs: state.legs,
    expiry: heldExpiry(state),
    openedAt: state.openedAt,
    strategyVersionId: null,
    rolledFrom: null,
  };
}
