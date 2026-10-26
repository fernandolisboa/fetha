import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { seedRadarRead, seedSuggestion, type SeededSuggestion } from "@/db/test/suggestion";
import { tradingSessions } from "@/modules/market-data/schema";

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

const { getSuggestion, getTodaySuggestions } = await import("./queries");

// Far past every other test's radar, so the newest read close is the one this test writes.
const SESSION = "2041-03-08";
const NEXT_SESSION = "2041-03-11";

const seeded: SeededSuggestion[] = [];

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  for (const suggestion of seeded.splice(0)) await suggestion.cleanup();
  await getDb().delete(tradingSessions).where(eq(tradingSessions.date, NEXT_SESSION));
});

function randomTicker() {
  return tickerSchema.parse(
    `QV${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`,
  );
}

describe("getSuggestion's validity (docs/adr/0073)", () => {
  it("stays open until the radar reads a newer close, then is archived", async () => {
    const suggestion = await seedSuggestion(getDb(), randomTicker(), SESSION, "2041-04-19");
    seeded.push(suggestion);

    expect((await getSuggestion(suggestion.id)).validity).toEqual({ archived: false });

    const removeRead = await seedRadarRead(getDb(), NEXT_SESSION);
    try {
      expect((await getSuggestion(suggestion.id)).validity).toEqual({
        archived: true,
        supersededBy: NEXT_SESSION,
      });
    } finally {
      await removeRead();
    }

    expect((await getSuggestion(suggestion.id)).validity).toEqual({ archived: false });
  });
});

describe("getTodaySuggestions (docs/adr/0073)", () => {
  it("keeps the newest read close's suggestions and counts the closes the radar is overdue on", async () => {
    const suggestion = await seedSuggestion(getDb(), randomTicker(), SESSION, "2041-04-19");
    seeded.push(suggestion);
    await getDb()
      .insert(tradingSessions)
      .values({
        date: NEXT_SESSION,
        open: new Date(`${NEXT_SESSION}T13:00:00.000Z`),
        close: new Date(`${NEXT_SESSION}T20:00:00.000Z`),
      })
      .onConflictDoNothing();
    const removeRead = await seedRadarRead(getDb(), SESSION);
    try {
      const overdue = async (now: string) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(now));
        const today = await getTodaySuggestions();
        vi.useRealTimers();
        expect(today.kind === "open" && today.suggestions.map((s) => s.id)).toContain(
          suggestion.id,
        );
        return today.kind === "open" ? today.overdueSessions : null;
      };

      expect(await overdue("2041-03-11T22:00:00.000Z")).toBe(0);
      expect(await overdue("2041-03-12T15:00:00.000Z")).toBe(1);
      expect(await overdue("2041-03-30T12:00:00.000Z")).toBe(1);
    } finally {
      await removeRead();
    }
  });
});
