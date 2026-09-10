import { and, count, desc, eq } from "drizzle-orm";
import type { Ticker } from "@fetha/contracts";

import { watchlistItems } from "@/db/schema/watchlist";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface WatchlistItem {
  ticker: Ticker;
  addedAt: Date;
}

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
    await this.db
      .insert(watchlistItems)
      .values({ userId: this.userId, ticker })
      .onConflictDoNothing({
        target: [watchlistItems.userId, watchlistItems.ticker],
      });
  }

  async remove(ticker: Ticker): Promise<void> {
    await this.db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.userId, this.userId), eq(watchlistItems.ticker, ticker)));
  }
}
