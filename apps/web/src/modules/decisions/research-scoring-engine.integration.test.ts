import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type Ticker,
} from "@fetha/contracts";
import type { OperationPricing } from "@fetha/engine";

import { getDb } from "@/db/client";
import { assetReadingFixture } from "@/db/test/asset-reading";
import { deleteTestUser } from "@/db/test/cleanup";
import {
  cleanRadarFixture,
  EXPIRY_INDEX,
  SCAN_INDEX,
  SCAN_SESSION,
  seedRadarFixture,
  SESSIONS,
  type Scenario,
} from "@/db/test/radar-fixture";
import { user } from "@/modules/auth/schema";
import { optionDailyPrices, optionSeries } from "@/modules/market-data/schema";

import { storeSeededResearch } from "./research-e2e-seed";
import { ResearchRepository } from "./research-repository";
import { ResearchScoresRepository } from "./research-scores-repository";
import { scoreDueResearch } from "./research-scoring-service";

const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 3).toUpperCase();
const TICKER: Ticker = tickerSchema.parse(`ZRC${suffix}3`);

// The underlying drifts up to the scanned close and then stays put, so a covered call written
// out of the money keeps its whole premium and the stock neither gains nor loses.
const FLAT_AFTER_SCAN: Scenario = {
  ticker: TICKER,
  close: (index) => (index <= SCAN_INDEX ? 10 + 0.002 * index : 10 + 0.002 * SCAN_INDEX),
  iv: () => 0.4,
  optionsTradeOn: () => true,
  ivPointOn: () => true,
};

const emails: string[] = [];

beforeAll(async () => {
  await seedRadarFixture([FLAT_AFTER_SCAN]);
}, 180_000);

afterAll(async () => {
  for (const email of emails.splice(0)) await deleteTestUser(getDb(), email);
  await cleanRadarFixture();
});

describe("scoreDueResearch with the real engine (docs/adr/0076)", () => {
  it("scores a covered call as the stock bought and the call written at the researched prices", async () => {
    const db = getDb();
    const email = `fetha-research-engine-${crypto.randomUUID()}@example.com`;
    emails.push(email);
    const [owner] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: "Test User",
        email,
        emailVerified: true,
        termsVersion: "2026-09-09",
        termsAcceptedAt: new Date(),
      })
      .returning({ id: user.id });
    if (!owner) throw new Error("failed to insert test user");

    const expiry = sessionDateSchema.parse(SESSIONS[EXPIRY_INDEX]);
    const spot = FLAT_AFTER_SCAN.close(SCAN_INDEX);
    const [series] = await db
      .select()
      .from(optionSeries)
      .where(
        and(
          eq(optionSeries.underlying, TICKER),
          eq(optionSeries.right, "call"),
          eq(optionSeries.strike, (Math.ceil((spot + 1) * 4) / 4).toFixed(2)),
        ),
      );
    if (!series) throw new Error("fixture has no call series above the money");
    const [entry] = await db
      .select({ close: optionDailyPrices.close })
      .from(optionDailyPrices)
      .where(
        and(
          eq(optionDailyPrices.ticker, series.ticker),
          eq(optionDailyPrices.session, SCAN_SESSION),
        ),
      );
    const [exit] = await db
      .select({ close: optionDailyPrices.close })
      .from(optionDailyPrices)
      .where(
        and(eq(optionDailyPrices.ticker, series.ticker), eq(optionDailyPrices.session, expiry)),
      );
    if (!entry || !exit) throw new Error("fixture has no option prices");

    const stockPrice = decimalStringSchema.parse(spot.toFixed(2));
    const callPrice = decimalStringSchema.parse(entry.close);
    const researchId = await storeSeededResearch(db, owner, {
      research: {
        newestClose: sessionDateSchema.parse(SCAN_SESSION),
        sessionsLooked: 1,
        candidates: 1,
        dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 },
        usingDefaultProfile: true,
      },
      model: "claude-opus-5-5",
      overview: "Visão geral",
      ideas: [
        {
          underlying: TICKER,
          recipeId: "covered-call-high-iv",
          foundOn: sessionDateSchema.parse(SCAN_SESSION),
          suggestionId: null,
          sessionsToExpiry: EXPIRY_INDEX - SCAN_INDEX,
          legs: [
            {
              role: "stock",
              side: "buy",
              ticker: TICKER,
              strike: null,
              expiry: null,
              quantity: quantitySchema.parse(100),
              price: stockPrice,
            },
            {
              role: "call",
              side: "sell",
              ticker: tickerSchema.parse(series.ticker),
              strike: decimalStringSchema.parse(series.strike),
              expiry,
              quantity: quantitySchema.parse(100),
              price: callPrice,
            },
          ],
          pricing: {
            at: `${SCAN_SESSION}T20:00:00.000Z`,
            underlying: TICKER,
            spot: stockPrice,
            legs: [],
            netPremium: centavosSchema.parse(0),
            breakEvens: [stockPrice],
            payoff: [],
            maxLoss: centavosSchema.parse(100000),
            maxGain: centavosSchema.parse(10000),
          } as unknown as OperationPricing,
          reading: assetReadingFixture(TICKER, SCAN_SESSION),
          engineAlerts: [],
          verdict: "do_not_enter",
          justification: "Justificativa",
          aiAlerts: [],
          claim: { kind: "operation_pnl_positive" },
          horizon: expiry,
        },
      ],
    });
    const [ideaId] = await new ResearchRepository(db, owner).ideaIdsOf(researchId);
    if (!ideaId) throw new Error("seed stored no idea");

    const outcome = await scoreDueResearch(db, expiry);
    expect(outcome).toMatchObject({ scored: 1, errors: 0 });

    const scores = await new ResearchScoresRepository(db, owner).findForIdeas([ideaId]);
    const score = scores.get(ideaId);
    expect(score?.unscorableReason).toBeNull();
    expect(score?.claimHeld).toBe(true);
    // The call expires worthless but for its 0.01 floor: the premium written less that floor
    // is the whole result before costs, so the lot earns a little less than that.
    const grossCentavos = Math.round((Number(entry.close) - Number(exit.close)) * 100 * 100);
    expect(score?.pnlCentavos).toBeGreaterThan(0);
    expect(score?.pnlCentavos).toBeLessThanOrEqual(grossCentavos);
    expect(score?.pnlCentavos).toBeGreaterThan(grossCentavos * 0.5);
  }, 120_000);
});
