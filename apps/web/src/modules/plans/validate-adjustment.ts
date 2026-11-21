import type { Structure, Ticker } from "@fetha/contracts";

import type { PlanChainEntry } from "./chain-view";
import { MAX_LOTS_SEARCHED } from "./sizing";
import { optionLegsOf } from "./template-legs";

// Whether a user's drag-to-adjust edit still conforms to the structure it claims to be (ticket
// #380, blocking item 4): the server never trusts a client-sent ticker list to already be a
// valid instance of the recipe's own structure. Checks, in order: exactly one ticker per
// non-stock template leg (catches a wrong leg count); every chain entry actually exists and its
// own listed `right` matches the template's role (catches role≠right); every option leg shares
// one expiry (catches a mixed-expiry edit); legs at the same strike rank (a box spread's own
// two legs at one strike) land on the exact same strike; and strikes increase strictly from one
// rank to the next (catches equal or inverted strikes). `lots` is bounded to the same cap
// `chooseLotSize` ever searches up to.
export function validateStructuralAdjustment(
  structure: Structure,
  chain: readonly PlanChainEntry[],
  optionTickers: readonly Ticker[],
  lots: number,
): boolean {
  if (!Number.isInteger(lots) || lots < 1 || lots > MAX_LOTS_SEARCHED) return false;

  const optionLegs = optionLegsOf(structure);
  if (optionTickers.length !== optionLegs.length) return false;

  const byTicker = new Map(chain.map((entry) => [entry.ticker, entry]));
  const resolved: { rank: number; entry: PlanChainEntry }[] = [];
  for (const [index, template] of optionLegs.entries()) {
    const ticker = optionTickers[index];
    const entry = ticker ? byTicker.get(ticker) : undefined;
    if (!entry || entry.right !== template.role) return false;
    resolved.push({ rank: template.strikeRank, entry });
  }

  const expiries = new Set(resolved.map(({ entry }) => entry.expiry));
  if (expiries.size !== 1) return false;

  const strikeByRank = new Map<number, number>();
  for (const { rank, entry } of resolved) {
    const strike = Number(entry.strike);
    const existing = strikeByRank.get(rank);
    if (existing !== undefined && existing !== strike) return false;
    strikeByRank.set(rank, strike);
  }

  const ranksAscending = [...strikeByRank.entries()].sort(([a], [b]) => a - b);
  for (let i = 1; i < ranksAscending.length; i += 1) {
    const previousStrike = ranksAscending[i - 1]?.[1];
    const currentStrike = ranksAscending[i]?.[1];
    if (previousStrike === undefined || currentStrike === undefined) return false;
    if (!(currentStrike > previousStrike)) return false;
  }

  return true;
}
