import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  tickerSchema,
  type DecimalString,
  type StrategyDefinition,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";

import { evaluations } from "./schema";
import { StrategiesRepository } from "./strategies-repository";

// Proves drizzle/0020_backfill_evaluation_reason.sql actually backfills the
// shapes it claims to (#133 follow-up, ADR-0039): seeds rows exactly as a
// pre-#80 evaluations table held them (reason NULL, an English `detail`
// sentence, or one of the pre-#133 web-authored `code:parameter` strings),
// runs the migration file's own statements verbatim, and asserts the
// resulting reason/detail split — not a re-implementation of the SQL, the
// actual file the migration ships.
const migrationStatements = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "drizzle",
    "0020_backfill_evaluation_reason.sql",
  ),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function uniqueEmail(label: string): string {
  return `fetha-backfill-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`BF${suffix}`);
}

async function insertBareUser(email: string): Promise<{ id: string; name: string; email: string }> {
  const [row] = await getDb()
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Test User",
      email,
      emailVerified: true,
      termsVersion: "2026-09-09",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: user.id, name: user.name, email: user.email });
  if (!row) throw new Error("failed to insert test user");
  return row;
}

function definition(): StrategyDefinition {
  return {
    name: "Backfill test",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
    exit: [],
    adjustments: [],
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("0020_backfill_evaluation_reason.sql", () => {
  it("rewrites every pre-#80/#133 row shape into the reason/detail split strings.ts now renders", async () => {
    const db = getDb();
    const email = uniqueEmail("legacy-rows");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("test setup: expected a version");

    const legacySentenceRows: { ticker: Ticker; detail: string; expectedReason: string }[] = [
      {
        ticker: randomTicker(),
        detail: "no candles for this instrument and timeframe",
        expectedReason: "no_candles",
      },
      {
        ticker: randomTicker(),
        detail: "no candles in (since, at] for this instrument and timeframe",
        expectedReason: "no_candles_in_catch_up_window",
      },
      {
        ticker: randomTicker(),
        detail: "entry condition needs more warm-up data",
        expectedReason: "entry_condition_warmup",
      },
      {
        ticker: randomTicker(),
        detail: "no listed option series satisfies the strike and expiry selection",
        expectedReason: "no_series_match",
      },
      {
        ticker: randomTicker(),
        detail: "two distinct strike ranks resolved to the same listed strike",
        expectedReason: "degenerate_strikes",
      },
      {
        ticker: randomTicker(),
        detail: "no declared capital to size against",
        expectedReason: "no_declared_capital",
      },
      {
        ticker: randomTicker(),
        detail: "fixed_risk sizing is unsizeable against an unbounded max loss",
        expectedReason: "unbounded_max_loss",
      },
      {
        ticker: randomTicker(),
        detail: "sizing yields fewer than one unit",
        expectedReason: "zero_units",
      },
      {
        ticker: randomTicker(),
        detail: "a unit carries no cost or risk to size against",
        expectedReason: "zero_units",
      },
      {
        ticker: randomTicker(),
        detail: "the declared capital and fraction cannot afford one unit",
        expectedReason: "unaffordable_budget",
      },
      {
        ticker: randomTicker(),
        detail: "not enough market data to select strikes or price the proposal",
        expectedReason: "insufficient_market_data_for_proposal",
      },
      {
        ticker: randomTicker(),
        detail: "profit_target cannot fire: the operation's premium base is zero",
        expectedReason: "profit_target_zero_base",
      },
      {
        ticker: randomTicker(),
        detail: "stop_loss cannot fire: the operation's max-loss base is zero",
        expectedReason: "stop_loss_zero_base",
      },
    ];

    const webCodeRows: {
      ticker: Ticker;
      detail: string;
      expectedReason: string;
      expectedDetail: string | null;
    }[] = [
      {
        ticker: randomTicker(),
        detail: "unknown_structure",
        expectedReason: "unknown_structure",
        expectedDetail: null,
      },
      {
        ticker: randomTicker(),
        detail: "engine_error:unsizeable",
        expectedReason: "engine_error",
        expectedDetail: "unsizeable",
      },
      {
        ticker: randomTicker(),
        detail: "catchup_clamped:8",
        expectedReason: "catchup_clamped",
        expectedDetail: "8",
      },
      {
        ticker: randomTicker(),
        detail: "unsatisfiable_collection:impliedVolatilityIndex",
        expectedReason: "unsatisfiable_collection",
        expectedDetail: "impliedVolatilityIndex",
      },
    ];

    const untouchedRow: { ticker: Ticker; outcome: "insufficient_data"; detail: string } = {
      ticker: randomTicker(),
      outcome: "insufficient_data",
      detail: "no_market_data",
    };

    await db.insert(evaluations).values([
      ...legacySentenceRows.map((row) => ({
        userId: owner.id,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        ticker: row.ticker,
        session: "2019-06-17",
        at: new Date("2019-06-17T21:00:00.000Z"),
        outcome: "insufficient_data" as const,
        reason: null,
        detail: row.detail,
      })),
      ...webCodeRows.map((row) => ({
        userId: owner.id,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        ticker: row.ticker,
        session: "2019-06-17",
        at: new Date("2019-06-17T21:00:00.000Z"),
        outcome: "insufficient_data" as const,
        reason: null,
        detail: row.detail,
      })),
      {
        userId: owner.id,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        ticker: untouchedRow.ticker,
        session: "2019-06-17",
        at: new Date("2019-06-17T21:00:00.000Z"),
        outcome: untouchedRow.outcome,
        reason: null,
        detail: untouchedRow.detail,
      },
    ]);

    for (const statement of migrationStatements) {
      await db.execute(sql.raw(statement));
    }

    const rows = await db
      .select({
        ticker: evaluations.ticker,
        reason: evaluations.reason,
        detail: evaluations.detail,
      })
      .from(evaluations)
      .where(sql`${evaluations.strategyVersionId} = ${version.id}`);
    const byTicker = new Map(rows.map((row) => [row.ticker, row]));

    for (const { ticker, expectedReason } of legacySentenceRows) {
      const row = byTicker.get(ticker);
      expect(row?.reason, `reason for ${ticker}`).toBe(expectedReason);
    }

    for (const { ticker, expectedReason, expectedDetail } of webCodeRows) {
      const row = byTicker.get(ticker);
      expect(row?.reason, `reason for ${ticker}`).toBe(expectedReason);
      expect(row?.detail, `detail for ${ticker}`).toBe(expectedDetail);
    }

    const untouched = byTicker.get(untouchedRow.ticker);
    expect(untouched?.reason).toBeNull();
    expect(untouched?.detail).toBe("no_market_data");
  });
});
