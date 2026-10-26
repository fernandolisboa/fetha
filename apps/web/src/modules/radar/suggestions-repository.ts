import { thesisClaimSchema, type SessionDate, type ThesisClaim } from "@fetha/contracts";
import type { AssetReading, Leg, OperationPricing, Score } from "@fetha/engine";
import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/client";

import { radarFactsSchema, radarLegsSchema, type RadarFacts, type RadarLeg } from "./match";
import { newestReadSession } from "./radar-repository";
import { radarMatches, radarReadings, suggestions, suggestionScores } from "./schema";

const suggestionLegsSchema = z
  .array(
    z.strictObject({
      role: z.enum(["stock", "call", "put"]),
      side: z.enum(["buy", "sell"]),
      ticker: z.string().min(1),
      quantity: z.number().int().positive(),
    }),
  )
  .min(1);

export interface StoredSuggestion {
  id: string;
  underlying: string;
  session: SessionDate;
  recipeId: string;
  asOf: Date;
  legs: Leg[];
  pricing: OperationPricing;
  claim: ThesisClaim;
  horizon: SessionDate;
}

export interface SuggestionInContext extends StoredSuggestion {
  reading: AssetReading | null;
  facts: RadarFacts;
  radarLegs: RadarLeg[];
}

const suggestionColumns = {
  id: suggestions.id,
  underlying: suggestions.underlying,
  session: suggestions.session,
  recipeId: suggestions.recipeId,
  asOf: suggestions.asOf,
  legs: suggestions.legs,
  pricing: suggestions.pricing,
  claim: suggestions.claim,
  horizon: suggestions.horizon,
};

type SuggestionRow = typeof suggestions.$inferSelect;

// jsonb is validated on read like the radar's own rows: a row an older shape wrote is dropped
// rather than rendered or scored wrong.
function toStored(row: SuggestionRow): StoredSuggestion | null {
  const legs = suggestionLegsSchema.safeParse(row.legs);
  const claim = thesisClaimSchema.safeParse(row.claim);
  if (!legs.success || !claim.success) return null;
  return { ...row, legs: row.legs, claim: claim.data };
}

function inContext(
  row: SuggestionRow & { reading: AssetReading | null; facts: unknown; radarLegs: unknown },
): SuggestionInContext | null {
  const stored = toStored(row);
  const facts = radarFactsSchema.safeParse(row.facts);
  const radarLegs = radarLegsSchema.safeParse(row.radarLegs);
  if (!stored || !facts.success || !radarLegs.success) return null;
  return { ...stored, reading: row.reading, facts: facts.data, radarLegs: radarLegs.data };
}

const contextColumns = {
  ...suggestionColumns,
  reading: radarReadings.reading,
  facts: radarMatches.facts,
  radarLegs: radarMatches.legs,
};

function withContext(db: Database) {
  return db
    .select(contextColumns)
    .from(suggestions)
    .innerJoin(
      radarMatches,
      and(
        eq(radarMatches.underlying, suggestions.underlying),
        eq(radarMatches.session, suggestions.session),
        eq(radarMatches.recipeId, suggestions.recipeId),
      ),
    )
    .innerJoin(
      radarReadings,
      and(
        eq(radarReadings.underlying, suggestions.underlying),
        eq(radarReadings.session, suggestions.session),
      ),
    );
}

// Reference data (docs/adr/0067): every user reads the same suggestions; nothing here is scoped.
export async function findSuggestion(
  db: Database,
  id: string,
): Promise<SuggestionInContext | null> {
  const [row] = await withContext(db).where(eq(suggestions.id, id)).limit(1);
  return row ? inContext(row) : null;
}

export async function suggestionIdFor(
  db: Database,
  underlying: string,
  session: SessionDate,
  recipeId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: suggestions.id })
    .from(suggestions)
    .where(
      and(
        eq(suggestions.underlying, underlying),
        eq(suggestions.session, session),
        eq(suggestions.recipeId, recipeId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// The suggestions of the radar's newest read session (the session `latestRadar` shows), so the
// cards and the radar tab never disagree on which close they speak for.
export async function latestSuggestions(db: Database): Promise<SuggestionInContext[]> {
  const session = await newestReadSession(db);
  if (!session) return [];
  const rows = await withContext(db)
    .where(eq(suggestions.session, session))
    .orderBy(asc(suggestions.underlying), asc(suggestions.recipeId));
  return rows.flatMap((row) => inContext(row) ?? []);
}

// Every suggestion whose horizon has arrived by `asOfSession` and that has no score yet.
export async function dueSuggestions(
  db: Database,
  asOfSession: SessionDate,
): Promise<StoredSuggestion[]> {
  const rows = await db
    .select(suggestionColumns)
    .from(suggestions)
    .leftJoin(suggestionScores, eq(suggestionScores.suggestionId, suggestions.id))
    .where(and(isNull(suggestionScores.id), lte(suggestions.horizon, asOfSession)))
    .orderBy(asc(suggestions.horizon), asc(suggestions.id));
  return rows.flatMap((row) => toStored(row) ?? []);
}

export type NewSuggestionScore =
  | {
      suggestionId: string;
      score: Score;
      claimHeld: boolean | null;
      pnlCentavos: number | null;
      maxLossCentavos: number | null;
      normalizedPnl: string | null;
      engineVersion: string;
    }
  | { suggestionId: string; unscorableReason: string; engineVersion: string };

export async function insertSuggestionScore(
  db: Database,
  row: NewSuggestionScore,
): Promise<{ inserted: boolean }> {
  const inserted = await db
    .insert(suggestionScores)
    .values(row)
    .onConflictDoNothing({ target: suggestionScores.suggestionId })
    .returning({ id: suggestionScores.id });
  return { inserted: inserted.length > 0 };
}

export interface ScoredSuggestionRow {
  recipeId: string;
  claimHeld: boolean | null;
  pnlCentavos: number | null;
  normalizedPnl: string | null;
}

export async function scoredSuggestions(db: Database): Promise<ScoredSuggestionRow[]> {
  return db
    .select({
      recipeId: suggestions.recipeId,
      claimHeld: suggestionScores.claimHeld,
      pnlCentavos: suggestionScores.pnlCentavos,
      normalizedPnl: suggestionScores.normalizedPnl,
    })
    .from(suggestionScores)
    .innerJoin(suggestions, eq(suggestions.id, suggestionScores.suggestionId))
    .where(isNotNull(suggestionScores.score))
    .orderBy(asc(suggestions.recipeId));
}
