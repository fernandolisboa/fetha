import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { tickerSchema, type Ticker } from "@fetha/contracts";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { seedSuggestion, type SeededSuggestion } from "@/db/test/suggestion";
import { user } from "@/modules/auth/schema";

import { suggestionSightings } from "./schema";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(new Repository(db, currentUser));
    },
  };
});

const { markSuggestionsSeenAction } = await import("./actions");
const { SuggestionSightingsRepository } = await import("./suggestion-sightings-repository");
const { PreferencesRepository } = await import("@/modules/preferences");

// A session no other test reads as the radar's newest, so these suggestions stay out of theirs.
const SESSION = "2001-03-05";
const EXPIRY = "2099-11-20";

function uniqueTicker(): Ticker {
  return tickerSchema.parse(
    `SG${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`,
  );
}

function uniqueEmail(label: string): string {
  return `fetha-sightings-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<CurrentUser> {
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
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    });
  if (!row) throw new Error("failed to insert test user");
  return row;
}

function isRedirectError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT;")
  );
}

const createdEmails: string[] = [];
const seeded: SeededSuggestion[] = [];

async function suggestion(): Promise<string> {
  const row = await seedSuggestion(getDb(), uniqueTicker(), SESSION, EXPIRY);
  seeded.push(row);
  return row.id;
}

afterEach(async () => {
  currentUser = null;
  for (const email of createdEmails.splice(0)) await deleteTestUser(getDb(), email);
});

afterAll(async () => {
  for (const row of seeded.splice(0)) await row.cleanup();
});

describe("SuggestionSightingsRepository isolation (docs/adr/0074)", () => {
  it("user A's sightings are invisible to user B, and B's never touch A's", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const id = await suggestion();

    await new SuggestionSightingsRepository(db, userA).markSeen([id]);

    expect((await new SuggestionSightingsRepository(db, userB).firstSeen([id])).size).toBe(0);
    const seenByA = await new SuggestionSightingsRepository(db, userA).firstSeen([id]);
    expect(seenByA.get(id)).toBeInstanceOf(Date);

    await new SuggestionSightingsRepository(db, userB).markSeen([id]);
    const rows = await db
      .select({ userId: suggestionSightings.userId })
      .from(suggestionSightings)
      .where(eq(suggestionSightings.suggestionId, id));
    expect(rows.map((row) => row.userId).sort()).toEqual([userA.id, userB.id].sort());
    expect((await new SuggestionSightingsRepository(db, userA).firstSeen([id])).get(id)).toEqual(
      seenByA.get(id),
    );
  });

  it("keeps the first sighting when the same suggestion is seen again", async () => {
    const db = getDb();
    const email = uniqueEmail("again");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const id = await suggestion();
    const firstSeenAt = new Date("2026-10-20T12:00:00Z");
    await db
      .insert(suggestionSightings)
      .values({ userId: owner.id, suggestionId: id, firstSeenAt });

    await new SuggestionSightingsRepository(db, owner).markSeen([id]);

    expect((await new SuggestionSightingsRepository(db, owner).firstSeen([id])).get(id)).toEqual(
      firstSeenAt,
    );
  });

  it("ignores an id that is not a stored suggestion", async () => {
    const db = getDb();
    const email = uniqueEmail("unknown");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const id = await suggestion();
    const unknown = crypto.randomUUID();

    await new SuggestionSightingsRepository(db, owner).markSeen([id, unknown]);

    const seen = await new SuggestionSightingsRepository(db, owner).firstSeen([id, unknown]);
    expect([...seen.keys()]).toEqual([id]);
  });
});

describe("SuggestionSightingsRepository.splitSeen (docs/adr/0074)", () => {
  it("moves off only what this user saw at least the delay ago", async () => {
    const db = getDb();
    const emailA = uniqueEmail("split-a");
    const emailB = uniqueEmail("split-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const [old, recent, unseen] = [await suggestion(), await suggestion(), await suggestion()];
    const now = new Date("2026-10-27T15:00:00Z");
    await db.insert(suggestionSightings).values([
      { userId: userA.id, suggestionId: old, firstSeenAt: new Date("2026-10-26T14:00:00Z") },
      { userId: userA.id, suggestionId: recent, firstSeenAt: new Date("2026-10-27T03:00:00Z") },
      { userId: userB.id, suggestionId: unseen, firstSeenAt: new Date("2026-10-20T12:00:00Z") },
    ]);
    const items = [{ id: old }, { id: recent }, { id: unseen }];

    const forA = await new SuggestionSightingsRepository(db, userA).splitSeen(items, 24, now);
    expect(forA.shown.map(({ id }) => id)).toEqual([recent, unseen]);
    expect(forA.archivedSeen.map(({ id }) => id)).toEqual([old]);

    const off = await new SuggestionSightingsRepository(db, userA).splitSeen(items, null, now);
    expect(off.archivedSeen).toEqual([]);

    const forB = await new SuggestionSightingsRepository(db, userB).splitSeen(items, 12, now);
    expect(forB.archivedSeen.map(({ id }) => id)).toEqual([unseen]);
  });
});

describe("markSuggestionsSeenAction", () => {
  it("records the signed-in user's sightings while automatic archiving is on", async () => {
    const email = uniqueEmail("action");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    await new PreferencesRepository(getDb(), currentUser).setSuggestionArchive("24");
    const id = await suggestion();

    expect(await markSuggestionsSeenAction([id, id])).toEqual({ status: "ok" });

    const seen = await new SuggestionSightingsRepository(getDb(), currentUser).firstSeen([id]);
    expect(seen.has(id)).toBe(true);
  });

  it("records nothing while automatic archiving is off", async () => {
    const email = uniqueEmail("action-off");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    const id = await suggestion();

    expect(await markSuggestionsSeenAction([id])).toEqual({ status: "ok" });

    const seen = await new SuggestionSightingsRepository(getDb(), currentUser).firstSeen([id]);
    expect(seen.size).toBe(0);
  });

  it("rejects input that is not a short list of suggestion ids", async () => {
    const email = uniqueEmail("invalid");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    expect(await markSuggestionsSeenAction("x")).toEqual({ status: "error" });
    expect(await markSuggestionsSeenAction([])).toEqual({ status: "error" });
    expect(await markSuggestionsSeenAction(["not-an-id"])).toEqual({ status: "error" });
    expect(
      await markSuggestionsSeenAction(Array.from({ length: 101 }, () => crypto.randomUUID())),
    ).toEqual({ status: "error" });
  });

  it("sends a signed-out caller to sign in", async () => {
    await expect(markSuggestionsSeenAction([crypto.randomUUID()])).rejects.toSatisfy(
      isRedirectError,
    );
  });
});
