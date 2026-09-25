import type { SessionDate } from "@fetha/contracts";
import type { LegRole } from "@fetha/engine";

import type { Database } from "@/db/client";
import { expiryByTicker } from "@/modules/market-data";
import type { ContemplatedOperation } from "@/modules/portfolio";
import type { SignalListItem } from "@/modules/strategies";

import { deriveDefaultHorizon } from "./horizon";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";

interface HorizonLeg {
  role: LegRole;
  ticker: string;
}

// The "which legs feed the horizon" rule lives here, not in a page: an exit
// signal carries no proposal (no new legs), an entry/adjust signal's legs
// come from its proposal, and a contemplated operation's legs are already
// on the record.
function legsForSignal(signal: SignalListItem): readonly HorizonLeg[] {
  if (signal.kind === "exit") {
    return [];
  }
  return signal.proposal?.legs ?? [];
}

async function defaultHorizonsFor<T>(
  db: Database,
  items: readonly T[],
  idOf: (item: T) => string,
  legsOf: (item: T) => readonly HorizonLeg[],
  now: Date,
): Promise<Map<string, SessionDate | null>> {
  const legsById = new Map(items.map((item) => [idOf(item), legsOf(item)]));
  const allOptionTickers = [...legsById.values()]
    .flat()
    .filter((leg) => leg.role !== "stock")
    .map((leg) => leg.ticker);
  const expiries = await expiryByTicker(db, allOptionTickers);
  const today = todaySaoPauloDate(now);

  const result = new Map<string, SessionDate | null>();
  for (const [id, legs] of legsById) {
    const derived = deriveDefaultHorizon(
      legs.map((leg) => ({ role: leg.role, expiry: expiries.get(leg.ticker) ?? null })),
    );
    // Never prefill a default that is already in the past (a signal on an
    // expired series, an expired saved operation on /carteira): the user
    // must pick a horizon by hand in that case, same as the no-option-leg
    // case `deriveDefaultHorizon` already returns null for.
    result.set(id, derived !== null && derived >= today ? derived : null);
  }
  return result;
}

// Batched over every row on the page (one `expiryByTicker` call, not one per
// row): the /sinais page's own default horizons, keyed by signal id.
export async function defaultHorizonsForSignals(
  db: Database,
  signals: readonly SignalListItem[],
  now: Date = new Date(),
): Promise<Map<string, SessionDate | null>> {
  return defaultHorizonsFor(db, signals, (signal) => signal.id, legsForSignal, now);
}

// The /carteira page's own default horizons, keyed by contemplated
// operation id.
export async function defaultHorizonsForOperations(
  db: Database,
  operations: readonly ContemplatedOperation[],
  now: Date = new Date(),
): Promise<Map<string, SessionDate | null>> {
  return defaultHorizonsFor(
    db,
    operations,
    (operation) => operation.id,
    (operation) => operation.legs,
    now,
  );
}

// A held operation's default horizon is its own expiry (UBIQUITOUS_LANGUAGE.md
// "Horizon"), under the same never-in-the-past rule; a stock-only operation
// has none.
export function defaultHorizonForHeldOperation(
  expiry: SessionDate | null,
  now: Date = new Date(),
): SessionDate | null {
  return expiry !== null && expiry >= todaySaoPauloDate(now) ? expiry : null;
}
