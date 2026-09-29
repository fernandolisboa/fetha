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

type SeedRow = {
  ticker: Ticker;
  outcome: "insufficient_data" | "conditions_not_met";
  detail: string;
};

describe("0020_backfill_evaluation_reason.sql", () => {
  it("rewrites every pre-#80/#133 row shape into the reason/detail split strings.ts now renders", async () => {
    const db = getDb();
    const email = uniqueEmail("legacy-rows");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("test setup: expected a version");

    const legacySentenceRows: (SeedRow & { expectedReason: string })[] = [
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "no candles for this instrument and timeframe",
        expectedReason: "no_candles",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "no candles in (since, at] for this instrument and timeframe",
        expectedReason: "no_candles_in_catch_up_window",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "entry condition needs more warm-up data",
        expectedReason: "entry_condition_warmup",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "no listed option series satisfies the strike and expiry selection",
        expectedReason: "no_series_match",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "two distinct strike ranks resolved to the same listed strike",
        expectedReason: "degenerate_strikes",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "no declared capital to size against",
        expectedReason: "no_declared_capital",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "fixed_risk sizing is unsizeable against an unbounded max loss",
        expectedReason: "unbounded_max_loss",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "a unit carries no cost or risk to size against",
        expectedReason: "zero_units",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "the declared capital and fraction cannot afford one unit",
        expectedReason: "unaffordable_budget",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "not enough market data to select strikes or price the proposal",
        expectedReason: "insufficient_market_data_for_proposal",
      },
      {
        ticker: randomTicker(),
        outcome: "conditions_not_met",
        detail: "profit_target cannot fire: the operation's premium base is zero",
        expectedReason: "profit_target_zero_base",
      },
      {
        ticker: randomTicker(),
        outcome: "conditions_not_met",
        detail: "stop_loss cannot fire: the operation's max-loss base is zero",
        expectedReason: "stop_loss_zero_base",
      },
    ];

    // A zero-base sentence recorded alongside `insufficient_data` instead
    // of `conditions_not_met` (a shape only a pre-#80 row can carry): #80's
    // own current logic names that combination `exit_rule_unknown`. Both
    // zero-base sentences (stop_loss and profit_target) go through the same
    // companion statement.
    const insufficientDataZeroBaseRows: (SeedRow & { expectedReason: string })[] = [
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "stop_loss cannot fire: the operation's max-loss base is zero",
        expectedReason: "exit_rule_unknown",
      },
      {
        ticker: randomTicker(),
        outcome: "insufficient_data",
        detail: "profit_target cannot fire: the operation's premium base is zero",
        expectedReason: "exit_rule_unknown",
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
        detail: "market_view_too_large",
        expectedReason: "market_view_too_large",
        expectedDetail: null,
      },
      {
        ticker: randomTicker(),
        detail: "no_market_data",
        expectedReason: "no_market_data",
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

    // The pre-#59 sentence is deliberately left alone: it covered what is
    // now two distinct codes (zero_units, unaffordable_budget), so nothing
    // in the stored row disambiguates which one it was.
    const untouchedRow: SeedRow = {
      ticker: randomTicker(),
      outcome: "insufficient_data",
      detail: "sizing yields fewer than one unit",
    };

    // Guards the starts_with fix: this detail is not the `engine_error:`
    // prefix (an underscore is a single-character LIKE wildcard, so a
    // pre-fix version of this migration built on LIKE could have matched a
    // string it should not), so it must stay unbackfilled.
    const startsWithGuardRow: SeedRow = {
      ticker: randomTicker(),
      outcome: "insufficient_data",
      detail: "engine_errorXcode:foo",
    };

    await db.insert(evaluations).values(
      [...legacySentenceRows, ...insufficientDataZeroBaseRows, untouchedRow, startsWithGuardRow]
        .map((row) => ({
          userId: owner.id,
          strategyId: strategy.id,
          strategyVersionId: version.id,
          ticker: row.ticker,
          session: "2019-06-17",
          at: new Date("2019-06-17T21:00:00.000Z"),
          outcome: row.outcome,
          reason: null,
          detail: row.detail,
        }))
        .concat(
          webCodeRows.map((row) => ({
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
        ),
    );

    // 0020 ran before 0030 made evaluations append-only (docs/adr/0047):
    // replay it the way it ran then, with the trigger off only inside this
    // transaction.
    await db.transaction(async (tx) => {
      await tx.execute(sql`alter table evaluations disable trigger evaluations_append_only`);
      for (const statement of migrationStatements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(sql`alter table evaluations enable trigger evaluations_append_only`);
    });

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

    for (const { ticker, expectedReason } of insufficientDataZeroBaseRows) {
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
    expect(untouched?.detail).toBe("sizing yields fewer than one unit");

    const guarded = byTicker.get(startsWithGuardRow.ticker);
    expect(guarded?.reason).toBeNull();
    expect(guarded?.detail).toBe("engine_errorXcode:foo");
  });
});
