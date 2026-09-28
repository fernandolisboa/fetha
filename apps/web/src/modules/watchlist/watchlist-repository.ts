import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Ticker } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { watchlistItems } from "./schema";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface WatchlistItem {
  ticker: Ticker;
  addedAt: Date;
}

export type AddToWatchlistResult = { status: "added" } | { status: "cap" };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// CONTEXT.md's module ownership table: the watchlist is its own module, not
// market-data (which owns the instrument search this repository stores
// tickers from) and not strategies (which only reads a user's watchlist to
// evaluate signals over it).
export class WatchlistRepository extends UserScopedRepository {
  async list(): Promise<WatchlistItem[]> {
    const rows = await this.db
      .select({ ticker: watchlistItems.ticker, addedAt: watchlistItems.addedAt })
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, this.userId))
      .orderBy(desc(watchlistItems.addedAt));
    return rows;
  }

  async count(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, this.userId));
    return row?.value ?? 0;
  }

  async add(ticker: Ticker): Promise<void> {
    await this.insert(this.db, ticker);
  }

  // The count-then-insert an unlocked caller would otherwise do is a race
  // (two concurrent adds at cap-1 can both pass): everything runs inside
  // one per-user advisory lock, same pattern as
  // StrategiesRepository.enforceStrategyCap (#160, docs/adr/0032).
  async addWithCap(ticker: Ticker, cap: number): Promise<AddToWatchlistResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`watchlist:${this.userId}`}, 0))`,
      );
      const [row] = await tx
        .select({ value: count() })
        .from(watchlistItems)
        .where(eq(watchlistItems.userId, this.userId));
      if ((row?.value ?? 0) >= cap) {
        return { status: "cap" };
      }
      await this.insert(tx, ticker);
      return { status: "added" };
    });
  }

  async remove(ticker: Ticker): Promise<void> {
    await this.db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.userId, this.userId), eq(watchlistItems.ticker, ticker)));
  }

  private async insert(executor: Database | Transaction, ticker: Ticker): Promise<void> {
    await executor
      .insert(watchlistItems)
      .values({ userId: this.userId, ticker })
      .onConflictDoNothing({
        target: [watchlistItems.userId, watchlistItems.ticker],
      });
  }
}
