import { sessionDateSchema } from "@fetha/contracts";
import type { AssetReading } from "@fetha/engine";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { isMarketIndex } from "@/modules/market-data";

import { radarFactsSchema, radarLegsSchema, type RadarFacts, type RadarLeg } from "./match";
import type { RadarMatch } from "./read-underlying";
import type { Candidate } from "./research-rules";
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

// That session, with every reading (null while pending) and every match of that session. A
// session seeded but not read yet would claim that no recipe found an entry at a close nothing
// was read at.
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

async function recentReadSessions(db: Database, count: number): Promise<string[]> {
  const read = await db
    .selectDistinct({ session: radarReadings.session })
    .from(radarReadings)
    .where(isNotNull(radarReadings.reading))
    .orderBy(desc(radarReadings.session))
    .limit(count);
  return read.map((row) => row.session);
}

export interface RecentFindings {
  sessions: string[];
  findings: Candidate[];
}

// What the radar found over its last `count` read sessions (a session with at least one reading),
// newest first, each with the stored suggestion of that match when it has one. Reference data,
// like `latestRadar`: nothing here is per user.
export async function recentFindings(db: Database, count: number): Promise<RecentFindings> {
  const sessions = await recentReadSessions(db, count);
  if (sessions.length === 0) return { sessions, findings: [] };

  const rows = await db
    .select({
      underlying: radarMatches.underlying,
      session: radarMatches.session,
      recipeId: radarMatches.recipeId,
      suggestionId: suggestions.id,
    })
    .from(radarMatches)
    .leftJoin(
      suggestions,
      and(
        eq(suggestions.underlying, radarMatches.underlying),
        eq(suggestions.session, radarMatches.session),
        eq(suggestions.recipeId, radarMatches.recipeId),
      ),
    )
    .where(inArray(radarMatches.session, sessions));
  return {
    sessions,
    findings: rows.map((row) => ({ ...row, session: sessionDateSchema.parse(row.session) })),
  };
}

// The distinct underlyings the radar matched over its last `sessions` read sessions: the newest
// session's first, then the ones found in more sessions, then by ticker, minus `excluding` and
// market indexes (docs/adr/0062), at most `limit`. Applying both before the cap keeps a skipped
// name from taking a slot. Reference data, nothing per user.
export async function recentFindingUnderlyings(
  db: Database,
  input: { sessions: number; limit: number; excluding: readonly string[] },
): Promise<string[]> {
  const sessions = await recentReadSessions(db, input.sessions);
  if (sessions.length === 0) return [];

  const latest = sql<string>`max(${radarMatches.session})`;
  const sessionsFound = sql<number>`count(distinct ${radarMatches.session})`;
  const rows = await db
    .select({ underlying: radarMatches.underlying })
    .from(radarMatches)
    .where(inArray(radarMatches.session, sessions))
    .groupBy(radarMatches.underlying)
    .orderBy(desc(latest), desc(sessionsFound), asc(radarMatches.underlying));
  const excluded = new Set(input.excluding);
  return rows
    .map((row) => row.underlying)
    .filter((underlying) => !excluded.has(underlying) && !isMarketIndex(underlying))
    .slice(0, input.limit);
}
