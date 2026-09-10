import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { deleteTestUser } from "@/db/test/cleanup";

import { WatchlistRepository } from "./watchlist-repository";

function uniqueEmail(label: string): string {
  return `fetha-watchlist-${label}-${crypto.randomUUID()}@example.com`;
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

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("WatchlistRepository isolation", () => {
  it("user A cannot see user B's watchlist", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new WatchlistRepository(db, userB).add("PETR4");

    const listA = await new WatchlistRepository(db, userA).list();
    expect(listA).toEqual([]);
  });

  it("user A cannot remove an instrument from user B's watchlist", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a2");
    const emailB = uniqueEmail("b2");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new WatchlistRepository(db, userB).add("VALE3");
    await new WatchlistRepository(db, userA).remove("VALE3");

    const listB = await new WatchlistRepository(db, userB).list();
    expect(listB.map((item) => item.ticker)).toEqual(["VALE3"]);
  });
});

describe("WatchlistRepository", () => {
  it("adding the same ticker twice is idempotent", async () => {
    const db = getDb();
    const email = uniqueEmail("idempotent");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new WatchlistRepository(db, owner);

    await repository.add("ITUB4");
    await repository.add("ITUB4");

    const list = await repository.list();
    expect(list).toHaveLength(1);
  });

  it("lists most recently added first", async () => {
    const db = getDb();
    const email = uniqueEmail("order");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new WatchlistRepository(db, owner);

    await repository.add("BBAS3");
    await repository.add("PETR4");

    const list = await repository.list();
    expect(list.map((item) => item.ticker)).toEqual(["PETR4", "BBAS3"]);
  });

  it("removing an instrument not on the list is a no-op", async () => {
    const db = getDb();
    const email = uniqueEmail("noop");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new WatchlistRepository(db, owner);

    await expect(repository.remove("PETR4")).resolves.toBeUndefined();
    expect(await repository.list()).toEqual([]);
  });

  it("count reflects the number of instruments on the list", async () => {
    const db = getDb();
    const email = uniqueEmail("count");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new WatchlistRepository(db, owner);

    expect(await repository.count()).toBe(0);
    await repository.add("BBAS3");
    await repository.add("PETR4");
    expect(await repository.count()).toBe(2);
  });
});

describe("WatchlistRepository count isolation", () => {
  it("count only reflects the current user's own instruments", async () => {
    const db = getDb();
    const emailA = uniqueEmail("count-a");
    const emailB = uniqueEmail("count-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new WatchlistRepository(db, userB).add("VALE3");
    await new WatchlistRepository(db, userB).add("ITUB4");

    expect(await new WatchlistRepository(db, userA).count()).toBe(0);
    expect(await new WatchlistRepository(db, userB).count()).toBe(2);
  });
});
