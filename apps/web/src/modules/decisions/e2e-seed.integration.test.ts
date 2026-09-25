import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  centavosSchema,
  confidenceSchema,
  decimalStringSchema,
  quantitySchema,
  tickerSchema,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { structures } from "@/modules/strategies/schema";

import { DecisionsRepository } from "./decisions-repository";
import { seedE2EDecision, type SeedE2EDecisionInput } from "./e2e-seed";

function uniqueEmail(label: string): string {
  return `fetha-e2e-seed-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`ES${suffix}`);
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
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

function seedInput(ticker: Ticker): SeedE2EDecisionInput {
  return {
    underlying: ticker,
    session: "2026-09-08",
    decidedAt: new Date("2026-09-08T21:05:00.000Z"),
    horizon: "2026-09-09",
    legs: [{ role: "stock", side: "buy", ticker, quantity: quantitySchema.parse(100) }],
    netPremiumCentavos: centavosSchema.parse(300000),
    maxLossCentavos: centavosSchema.parse(300000),
    maxGainCentavos: null,
    claim: { kind: "close_above", instrument: ticker, level: decimalStringSchema.parse("1") },
    confidence: confidenceSchema.parse("0.7"),
    rationale: "seedE2EDecision integration test",
  };
}

const createdEmails: string[] = [];
const originalE2ESecret = process.env.E2E_SECRET;
const originalVercelEnv = process.env.VERCEL_ENV;

// `seedE2EDecision` now refuses on its own outside a real E2E environment
// (round 3 item 10), the same production/E2E_SECRET-configured check the
// route already runs: every test but the one exercising that refusal needs
// a configured secret and a non-production deployment, the same env shape
// CI's own E2E run gives the real route.
beforeEach(() => {
  process.env.E2E_SECRET = "test-e2e-secret";
  delete process.env.VERCEL_ENV;
});

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  if (originalE2ESecret === undefined) {
    delete process.env.E2E_SECRET;
  } else {
    process.env.E2E_SECRET = originalE2ESecret;
  }
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
});

// #29 fix-web item 3: `seedE2EDecision` never inserts into `structures`
// itself — a missing "stock" structure in the shared catalog is reported,
// not papered over.
describe("seedE2EDecision", () => {
  it("refuses before any write when no E2E secret is configured (round 3 item 10)", async () => {
    delete process.env.E2E_SECRET;
    const email = uniqueEmail("no-secret");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const result = await seedE2EDecision(getDb(), owner, seedInput(randomTicker()));

    expect(result).toEqual({ ok: false, reason: "e2e_not_available" });
    const decisionsRepository = new DecisionsRepository(getDb(), owner);
    expect(await decisionsRepository.listMine()).toEqual([]);
  });

  it("refuses before any write on a production deployment even with a secret configured (round 3 item 10)", async () => {
    process.env.VERCEL_ENV = "production";
    const email = uniqueEmail("production");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const result = await seedE2EDecision(getDb(), owner, seedInput(randomTicker()));

    expect(result).toEqual({ ok: false, reason: "e2e_not_available" });
    const decisionsRepository = new DecisionsRepository(getDb(), owner);
    expect(await decisionsRepository.listMine()).toEqual([]);
  });

  // Only the "stock" row is removed, and restored in `finally` regardless of
  // outcome (round-trip, not a destructive `DELETE FROM structures`): the
  // catalog is shared reference data other, sequentially-run integration
  // test files also depend on (`fileParallelism: false` makes "sequential"
  // a real guarantee here, not just a hope), so this test must leave it
  // exactly as it found it.
  it("returns missing_stock_structure when the shared catalog has no 'stock' structure", async () => {
    const db = getDb();
    const [existingStock] = await db.select().from(structures).where(eq(structures.id, "stock"));
    await db.delete(structures).where(eq(structures.id, "stock"));
    try {
      const email = uniqueEmail("missing-structure");
      createdEmails.push(email);
      const owner = await insertBareUser(email);

      const result = await seedE2EDecision(getDb(), owner, seedInput(randomTicker()));

      expect(result).toEqual({ ok: false, reason: "missing_stock_structure" });
    } finally {
      if (existingStock) {
        await db.insert(structures).values(existingStock).onConflictDoNothing();
      }
    }
  });

  it("records a decision backdated to decidedAt, with the horizon strictly after it, once the catalog has 'stock'", async () => {
    await getDb()
      .insert(structures)
      .values({
        id: "stock",
        name: "Compra de ação",
        legs: [{ role: "stock", side: "buy", ratio: 1 }],
      })
      .onConflictDoNothing();
    const email = uniqueEmail("ok");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const result = await seedE2EDecision(getDb(), owner, seedInput(ticker));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decisionsRepository = new DecisionsRepository(getDb(), owner);
    const [decision] = await decisionsRepository.listMine();
    expect(decision?.id).toBe(result.id);
    expect(decision?.horizon).toBe("2026-09-09");
    expect(decision?.decidedAt.toISOString()).toBe("2026-09-08T21:05:00.000Z");
  });
});
