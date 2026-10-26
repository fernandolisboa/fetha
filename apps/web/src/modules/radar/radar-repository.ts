import type { AssetReading } from "@fetha/engine";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db/client";

import { radarFactsSchema, radarLegsSchema, type RadarFacts, type RadarLeg } from "./match";
import type { RadarMatch } from "./read-underlying";
import { radarMatches, radarReadings, suggestions } from "./schema";

export interface StoredRadarReading {
  underlying: string;
  reading: AssetReading | null;
}

export interface StoredRadarMatch {
  underlying: string;
  recipeId: string;
  facts: RadarFacts;
  legs: RadarLeg[];
}

export interface StoredRadar {
  session: string;
  readings: StoredRadarReading[];
  matches: StoredRadarMatch[];
}

// Reference data written only by the nightly scan (docs/adr/0066): no user scoping, and no
// entry point exposes these writers to user-facing code.
export async function sessionHasUniverse(db: Database, session: string): Promise<boolean> {
  const [row] = await db
    .select({ underlying: radarReadings.underlying })
    .from(radarReadings)
    .where(eq(radarReadings.session, session))
    .limit(1);
  return row !== undefined;
}

export async function seedUniverse(
  db: Database,
  session: string,
  asOf: Date,
  underlyings: readonly string[],
): Promise<void> {
  if (underlyings.length === 0) return;
  await db
    .insert(radarReadings)
    .values(underlyings.map((underlying) => ({ underlying, session, asOf })))
    .onConflictDoNothing();
}

export async function pendingUnderlyings(db: Database, session: string): Promise<string[]> {
  const rows = await db
    .select({ underlying: radarReadings.underlying })
    .from(radarReadings)
    .where(and(eq(radarReadings.session, session), isNull(radarReadings.reading)))
    .orderBy(asc(radarReadings.underlying));
  return rows.map((row) => row.underlying);
}

export async function universeSize(db: Database, session: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(radarReadings)
    .where(eq(radarReadings.session, session));
  return row?.count ?? 0;
}

// The reading, its matches and their suggestions land together or not at all, so a reading is
// never stored without what was computed with it. Deleting the old matches cascades to their
// suggestions; the scan reads an underlying only while it is pending, so no user's decision
// points at a suggestion this rewrites (a decision's foreign key would refuse the delete).
export async function saveRead(
  db: Database,
  read: {
    underlying: string;
    session: string;
    asOf: Date;
    reading: AssetReading;
    matches: RadarMatch[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(radarReadings)
      .set({ reading: read.reading, computedAt: new Date() })
      .where(
        and(eq(radarReadings.underlying, read.underlying), eq(radarReadings.session, read.session)),
      );
    await tx
      .delete(radarMatches)
      .where(
        and(eq(radarMatches.underlying, read.underlying), eq(radarMatches.session, read.session)),
      );
    if (read.matches.length > 0) {
      await tx.insert(radarMatches).values(
        read.matches.map((match) => ({
          underlying: read.underlying,
          session: read.session,
          recipeId: match.recipeId,
          facts: radarFactsSchema.parse(match.facts),
          legs: radarLegsSchema.parse(match.legs),
        })),
      );
      const drafts = read.matches.flatMap((match) =>
        match.suggestion ? [{ recipeId: match.recipeId, ...match.suggestion }] : [],
      );
      if (drafts.length > 0) {
        await tx.insert(suggestions).values(
          drafts.map((draft) => ({
            underlying: read.underlying,
            session: read.session,
            recipeId: draft.recipeId,
            asOf: read.asOf,
            legs: draft.legs,
            pricing: draft.pricing,
            claim: draft.claim,
            horizon: draft.horizon,
          })),
        );
      }
    }
  });
}

// The newest session the radar has read at least one underlying of: the close the radar tab, the
// suggestion cards and a suggestion's archiving (docs/adr/0073) all speak for.
export async function newestReadSession(db: Database): Promise<string | null> {
  const [latest] = await db
    .select({ session: radarReadings.session })
    .from(radarReadings)
    .where(isNotNull(radarReadings.reading))
    .orderBy(desc(radarReadings.session))
    .limit(1);
  return latest?.session ?? null;
}

// That session, with every reading (null
// while pending) and every match of that session. A session seeded but not read yet would claim
// that no recipe found an entry at a close nothing was read at.
export async function latestRadar(db: Database): Promise<StoredRadar | null> {
  const session = await newestReadSession(db);
  if (!session) return null;

  const [readings, matches] = await Promise.all([
    db
      .select({ underlying: radarReadings.underlying, reading: radarReadings.reading })
      .from(radarReadings)
      .where(eq(radarReadings.session, session))
      .orderBy(asc(radarReadings.underlying)),
    db
      .select({
        underlying: radarMatches.underlying,
        recipeId: radarMatches.recipeId,
        facts: radarMatches.facts,
        legs: radarMatches.legs,
      })
      .from(radarMatches)
      .where(eq(radarMatches.session, session))
      .orderBy(asc(radarMatches.underlying), asc(radarMatches.recipeId)),
  ]);

  return {
    session,
    readings,
    matches: matches.flatMap((row) => {
      const facts = radarFactsSchema.safeParse(row.facts);
      const legs = radarLegsSchema.safeParse(row.legs);
      return facts.success && legs.success
        ? [
            {
              underlying: row.underlying,
              recipeId: row.recipeId,
              facts: facts.data,
              legs: legs.data,
            },
          ]
        : [];
    }),
  };
}
