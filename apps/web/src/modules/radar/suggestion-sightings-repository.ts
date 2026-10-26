import { and, eq, inArray, sql } from "drizzle-orm";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { suggestions, suggestionSightings } from "./schema";

export class SuggestionSightingsRepository extends UserScopedRepository {
  // Only ids of stored suggestions are recorded, and a repeat sighting keeps the first one.
  async markSeen(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .insert(suggestionSightings)
      .select(
        this.db
          .select({
            userId: sql<string>`${this.userId}::text`.as("user_id"),
            suggestionId: suggestions.id,
            firstSeenAt: sql<Date>`now()`.as("first_seen_at"),
          })
          .from(suggestions)
          .where(inArray(suggestions.id, [...ids])),
      )
      .onConflictDoNothing();
  }

  async firstSeen(ids: readonly string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        suggestionId: suggestionSightings.suggestionId,
        firstSeenAt: suggestionSightings.firstSeenAt,
      })
      .from(suggestionSightings)
      .where(
        and(
          eq(suggestionSightings.userId, this.userId),
          inArray(suggestionSightings.suggestionId, [...ids]),
        ),
      );
    return new Map(rows.map((row) => [row.suggestionId, row.firstSeenAt]));
  }
}
