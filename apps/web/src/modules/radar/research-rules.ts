import type { Centavos, SessionDate } from "@fetha/contracts";
import type { AssetReading, LimitBreach } from "@fetha/engine";

// docs/adr/0075: how far back the research looks, and when an idea is too close to its expiry to
// be worth acting on. These are this project's defaults, not figures from a reference.
export const RESEARCH_WINDOW_SESSIONS = 5;
// A lot expiring sooner than a trading week leaves no time to decide, order and be right.
export const MIN_SESSIONS_TO_EXPIRY = 5;
// Two trading weeks: where time decay speeds up enough to deserve a warning on the card.
export const NEAR_EXPIRY_SESSIONS = 10;

export const dropReasons = [
  "unpriced",
  "expires_too_soon",
  "exceeds_capital",
  "not_evaluable",
] as const;
export type DropReason = (typeof dropReasons)[number];

export type IdeaAlert =
  | { kind: "rule_no_longer_holds"; foundOn: SessionDate }
  | { kind: "limit_breach"; breach: LimitBreach }
  | { kind: "near_expiry"; sessionsLeft: number };

export interface Candidate {
  underlying: string;
  recipeId: string;
  session: SessionDate;
  suggestionId: string | null;
}

export function emptyDropped(): Record<DropReason, number> {
  return { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 };
}

export function dedupeCandidates(rows: readonly Candidate[]): Candidate[] {
  const ordered = [...rows].sort(
    (a, b) =>
      b.session.localeCompare(a.session) ||
      a.underlying.localeCompare(b.underlying) ||
      a.recipeId.localeCompare(b.recipeId),
  );
  const seen = new Set<string>();
  return ordered.filter((row) => {
    const key = `${row.underlying}:${row.recipeId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sessionsAfter(
  calendar: readonly SessionDate[],
  close: SessionDate,
  expiry: SessionDate,
): number {
  return calendar.filter((date) => date > close && date <= expiry).length;
}

export interface AssessmentInput {
  ruleHolds: boolean;
  foundOn: SessionDate;
  maxLoss: Centavos;
  sessionsToExpiry: number;
  declaredCapital: Centavos;
  breaches: readonly LimitBreach[];
}

export type Assessment =
  { kind: "drop"; reason: DropReason } | { kind: "idea"; holding: boolean; alerts: IdeaAlert[] };

export function assessIdea(input: AssessmentInput): Assessment {
  const { sessionsToExpiry } = input;
  if (sessionsToExpiry < MIN_SESSIONS_TO_EXPIRY) {
    return { kind: "drop", reason: "expires_too_soon" };
  }
  if (input.maxLoss > input.declaredCapital) return { kind: "drop", reason: "exceeds_capital" };

  const alerts: IdeaAlert[] = [];
  if (!input.ruleHolds) alerts.push({ kind: "rule_no_longer_holds", foundOn: input.foundOn });
  for (const breach of input.breaches) alerts.push({ kind: "limit_breach", breach });
  if (sessionsToExpiry <= NEAR_EXPIRY_SESSIONS) {
    alerts.push({ kind: "near_expiry", sessionsLeft: sessionsToExpiry });
  }
  return { kind: "idea", holding: input.ruleHolds, alerts };
}

// The radar's own rule (docs/adr/0066), never a score: how many option series traded at the
// close, then ticker, then recipe id.
export function sortIdeas<
  T extends {
    underlying: string;
    recipeId: string;
    reading: { options: Pick<AssetReading["options"], "tradedSeries"> };
  },
>(ideas: readonly T[]): T[] {
  return [...ideas].sort(
    (a, b) =>
      b.reading.options.tradedSeries - a.reading.options.tradedSeries ||
      a.underlying.localeCompare(b.underlying) ||
      a.recipeId.localeCompare(b.recipeId),
  );
}
