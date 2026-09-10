import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { deleteTestUser } from "@/db/test/cleanup";

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
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(currentUser);
    },
  };
});

function uniqueEmail(label: string): string {
  return `fetha-backtest-run-route-${label}-${crypto.randomUUID()}@example.com`;
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
    .returning({ id: user.id, name: user.name, email: user.email });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("POST /api/backtests/[id]/run", () => {
  it("rate limits after 6 requests in the window, the 7th POST returns 429 (round 2 item 5)", async () => {
    vi.resetModules();
    const { POST } = await import("./route");

    const email = uniqueEmail("rate-limit");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const call = (): Promise<Response> =>
      POST(new Request("http://localhost/api/backtests/does-not-exist/run", { method: "POST" }), {
        params: Promise.resolve({ id: "does-not-exist" }),
      });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await call();
      // The run does not exist, so every one of the first 6 calls reaches
      // (and consumes) the rate limit before failing on that later,
      // unrelated 404.
      expect(response.status).toBe(404);
    }

    const seventh = await call();
    expect(seventh.status).toBe(429);
    await expect(seventh.json()).resolves.toEqual({ ok: false, error: "rate_limited" });
  });
});
