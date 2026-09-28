import { and, count, desc, eq } from "drizzle-orm";
import type { Ticker } from "@fetha/contracts";

import type { Database, Transaction } from "@/db/client";
import { watchlistItems } from "./schema";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface WatchlistItem {
  ticker: Ticker;
  addedAt: Date;
}

export type AddToWatchlistResult = { status: "added" } | { status: "cap" };

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

  async add(ticker: Ticker): Promise<void> {
    await this.insert(this.db, ticker);
  }

  async addWithCap(ticker: Ticker, cap: number): Promise<AddToWatchlistResult> {
    return this.db.transaction(async (tx) => {
      await this.lockUserScope(tx, "watchlist");
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
