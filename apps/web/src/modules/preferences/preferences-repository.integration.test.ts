import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { deleteTestUser } from "@/db/test/cleanup";

import { PreferencesRepository } from "./preferences-repository";

function uniqueEmail(label: string): string {
  return `fetha-preferences-${label}-${crypto.randomUUID()}@example.com`;
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

describe("PreferencesRepository isolation", () => {
  it("user A cannot read or overwrite user B's preferences", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);

    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new PreferencesRepository(db, userA).setTheme("terminal");
    await new PreferencesRepository(db, userB).setTheme("amplo");

    const bPreferences = await new PreferencesRepository(db, userB).find();
    expect(bPreferences.theme).toBe("amplo");

    const aPreferences = await new PreferencesRepository(db, userA).find();
    expect(aPreferences.theme).toBe("terminal");
  });

  it("defaults to instrumento and an expanded rail before any preference is stored", async () => {
    const db = getDb();
    const email = uniqueEmail("default");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    const result = await new PreferencesRepository(db, testUser).find();

    expect(result).toEqual({ theme: "instrumento", railCollapsed: false });
  });

  it("persists the rail collapse state independently of the theme", async () => {
    const db = getDb();
    const email = uniqueEmail("rail");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new PreferencesRepository(db, testUser);

    await repository.setTheme("amplo");
    await repository.setRailCollapsed(true);

    const result = await repository.find();
    expect(result).toEqual({ theme: "amplo", railCollapsed: true });
  });
});
