import { asc, desc, eq, sql } from "drizzle-orm";
import {
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import { corporateActionFactors } from "../schema";

export interface CorporateActionFactorRow {
  ticker: Ticker;
  exDate: SessionDate;
  asOf: Date;
  factor: DecimalString;
  recordedAt: Date;
}

function toRow(row: typeof corporateActionFactors.$inferSelect): CorporateActionFactorRow {
  return {
    ticker: tickerSchema.parse(row.ticker),
    exDate: sessionDateSchema.parse(row.exDate),
    asOf: row.asOf,
    factor: decimalStringSchema.parse(row.factor),
    recordedAt: row.recordedAt,
  };
}

// The repository is the one edge storage-shaped rows cross (CLAUDE.md
// "validation at the edges"): every caller downstream gets `Ticker`,
// `SessionDate` and `DecimalString`, never a raw `string` to re-parse.
export async function corporateActionsForTicker(
  db: Database,
  ticker: string,
): Promise<CorporateActionFactorRow[]> {
  const rows = await db
    .select()
    .from(corporateActionFactors)
    .where(eq(corporateActionFactors.ticker, ticker))
    .orderBy(asc(corporateActionFactors.exDate));
  return rows.map(toRow);
}

export interface UpsertCorporateActionFactorInput {
  ticker: Ticker;
  exDate: SessionDate;
  asOf: Date;
  factor: DecimalString;
}

// Owner-entered writer (#50, ADR-0052): re-submitting the same `(ticker,
// exDate)` corrects a mistaken factor and bumps `recordedAt`, the only way to
// undo a wrong entry (there is deliberately no delete — a deleted row could
// never move `MarketView.dataVersion`, docs/adr/0052). `recordedAt` moves
// only when `(factor, as_of)` actually changes (`setWhere`, mirroring
// `upsertTradingSessions`'s own guard): an identical resubmission is then a
// true no-op that cannot fail a chunked run in progress on its own.
export async function upsertCorporateActionFactor(
  db: Database,
  input: UpsertCorporateActionFactorInput,
): Promise<void> {
  await db
    .insert(corporateActionFactors)
    .values({
      ticker: input.ticker,
      exDate: input.exDate,
      asOf: input.asOf,
      factor: input.factor,
    })
    .onConflictDoUpdate({
      target: [corporateActionFactors.ticker, corporateActionFactors.exDate],
      set: {
        asOf: sql`excluded.as_of`,
        factor: sql`excluded.factor`,
        recordedAt: sql`now()`,
      },
      setWhere: sql`(${corporateActionFactors.factor}, ${corporateActionFactors.asOf}) is distinct from (excluded.factor, excluded.as_of)`,
    });
}

// The most recently *recorded* factors across every ticker, for the
// owner-only list on /configuracoes: latest writes first is what the owner
// needs to confirm a backfill just landed, not the latest ex-date. Reference
// data, so no user scope.
export async function recentCorporateActionFactors(
  db: Database,
  limit: number,
): Promise<CorporateActionFactorRow[]> {
  const rows = await db
    .select()
    .from(corporateActionFactors)
    .orderBy(desc(corporateActionFactors.recordedAt))
    .limit(limit);
  return rows.map(toRow);
}
