import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { seedSuggestion, type SeededSuggestion } from "@/db/test/suggestion";
import { tradingSessions } from "@/modules/market-data/schema";

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

const { getSuggestion } = await import("./queries");

// Far past every other test's calendar, so the session after SESSION is NEXT_SESSION alone.
const SESSION = "2041-03-08";
const NEXT_SESSION = "2041-03-11";

const seeded: SeededSuggestion[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  for (const suggestion of seeded.splice(0)) await suggestion.cleanup();
  await getDb().delete(tradingSessions).where(eq(tradingSessions.date, NEXT_SESSION));
});

describe("getSuggestion's validity (docs/adr/0072)", () => {
  it("is open through the next trading session's day and archived from the day after", async () => {
    await getDb()
      .insert(tradingSessions)
      .values({
        date: NEXT_SESSION,
        open: new Date(`${NEXT_SESSION}T13:00:00.000Z`),
        close: new Date(`${NEXT_SESSION}T20:00:00.000Z`),
      })
      .onConflictDoNothing();
    const ticker = tickerSchema.parse(
      `QV${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`,
    );
    const suggestion = await seedSuggestion(getDb(), ticker, SESSION, "2041-04-19");
    seeded.push(suggestion);

    vi.stubEnv("E2E_TODAY", "2041-03-09");
    expect((await getSuggestion(suggestion.id)).validity).toEqual({
      openThrough: NEXT_SESSION,
      archived: false,
    });

    vi.stubEnv("E2E_TODAY", NEXT_SESSION);
    expect((await getSuggestion(suggestion.id)).validity.archived).toBe(false);

    vi.stubEnv("E2E_TODAY", "2041-03-12");
    expect((await getSuggestion(suggestion.id)).validity).toEqual({
      openThrough: NEXT_SESSION,
      archived: true,
    });
  });
});
