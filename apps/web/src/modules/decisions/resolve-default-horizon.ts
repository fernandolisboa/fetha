import type { SessionDate } from "@fetha/contracts";
import type { LegRole } from "@fetha/engine";

import type { Database } from "@/db/client";
import { expiryByTicker } from "@/modules/market-data";
import { getMyOpenOperationExpiries, type ContemplatedOperation } from "@/modules/portfolio";
import type { SignalListItem } from "@/modules/strategies";

import { deriveDefaultHorizon } from "./horizon";
import { horizonChecker } from "./horizon-status";

interface HorizonLeg {
  role: LegRole;
  ticker: string;
}

// The "which legs feed the horizon" rule lives here, not in a page: an exit
// signal carries no proposal (no new legs) and takes its operation's expiry
// instead (`defaultHorizonsForSignals`), an entry/adjust signal's legs come
// from its proposal, and a contemplated operation's legs are already on the
// record.
function legsForSignal(signal: SignalListItem): readonly HorizonLeg[] {
  if (signal.kind === "exit") {
    return [];
  }
  return signal.proposal?.legs ?? [];
}

async function derivedHorizonsFor<T>(
  db: Database,
  items: readonly T[],
  idOf: (item: T) => string,
  legsOf: (item: T) => readonly HorizonLeg[],
): Promise<Map<string, SessionDate | null>> {
  const legsById = new Map(items.map((item) => [idOf(item), legsOf(item)]));
  const allOptionTickers = [...legsById.values()]
    .flat()
    .filter((leg) => leg.role !== "stock")
    .map((leg) => leg.ticker);
  const expiries = await expiryByTicker(db, allOptionTickers);

  const result = new Map<string, SessionDate | null>();
  for (const [id, legs] of legsById) {
    result.set(
      id,
      deriveDefaultHorizon(
        legs.map((leg) => ({ role: leg.role, expiry: expiries.get(leg.ticker) ?? null })),
      ),
    );
  }
  return result;
}

// Never prefill a default the decision action would refuse (a signal on an
// expired series, an expired saved operation on /carteira, an expiry whose
// session closed today): the user must pick a horizon by hand in that case,
// same as the no-option-leg case `deriveDefaultHorizon` already returns
// null for (#259).
async function keepOpenHorizons(
  db: Database,
  horizons: Map<string, SessionDate | null>,
  now: Date,
): Promise<Map<string, SessionDate | null>> {
  const statusOf = horizonChecker(db, now);
  const result = new Map<string, SessionDate | null>();
  for (const [id, horizon] of horizons) {
    result.set(id, horizon !== null && (await statusOf(horizon)) === "open" ? horizon : null);
  }
  return result;
}

// Batched over every row on the page (one `expiryByTicker` call, not one per
// row): the /sinais page's own default horizons, keyed by signal id. An exit
// signal takes the expiry of the operation it names, the default a held
// operation gets on /carteira (#257).
export async function defaultHorizonsForSignals(
  db: Database,
  signals: readonly SignalListItem[],
  now: Date = new Date(),
): Promise<Map<string, SessionDate | null>> {
  const derived = await derivedHorizonsFor(db, signals, (signal) => signal.id, legsForSignal);
  const exitOperationIds = [
    ...new Set(
      signals.flatMap((signal) =>
        signal.kind === "exit" && signal.operationId !== null ? [signal.operationId] : [],
      ),
    ),
  ];
  if (exitOperationIds.length > 0) {
    const expiries = await getMyOpenOperationExpiries(exitOperationIds);
    for (const signal of signals) {
      if (signal.kind === "exit" && signal.operationId !== null) {
        derived.set(signal.id, expiries.get(signal.operationId) ?? null);
      }
    }
  }
  return keepOpenHorizons(db, derived, now);
}

// The /carteira page's own default horizons, keyed by contemplated
// operation id.
export async function defaultHorizonsForOperations(
  db: Database,
  operations: readonly ContemplatedOperation[],
  now: Date = new Date(),
): Promise<Map<string, SessionDate | null>> {
  return keepOpenHorizons(
    db,
    await derivedHorizonsFor(
      db,
      operations,
      (operation) => operation.id,
      (operation) => operation.legs,
    ),
    now,
  );
}

export interface HeldOperationExpiry {
  id: string;
  expiry: SessionDate | null;
}

// A held operation's default horizon is the expiry of its live option legs
// (UBIQUITOUS_LANGUAGE.md "Horizon", portfolio's `heldExpiry`), keyed by
// operation id; a stock-only operation has none.
export async function defaultHorizonsForHeldOperations(
  db: Database,
  operations: readonly HeldOperationExpiry[],
  now: Date = new Date(),
): Promise<Map<string, SessionDate | null>> {
  return keepOpenHorizons(
    db,
    new Map(operations.map((operation) => [operation.id, operation.expiry])),
    now,
  );
}
