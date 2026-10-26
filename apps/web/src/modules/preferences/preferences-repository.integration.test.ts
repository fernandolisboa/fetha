import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { preferences } from "./schema";

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

  it("user A dismissing the tour leaves user B's tour pending", async () => {
    const db = getDb();
    const emailA = uniqueEmail("tour-a");
    const emailB = uniqueEmail("tour-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    await new PreferencesRepository(db, userB).setTheme("amplo");

    await new PreferencesRepository(db, userA).dismissTour();

    expect((await new PreferencesRepository(db, userA).find()).tourDismissed).toBe(true);
    expect(await new PreferencesRepository(db, userB).find()).toEqual({
      theme: "amplo",
      layout: "workspace",
      railCollapsed: false,
      tourDismissed: false,
      assetTourDismissed: false,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
  });

  it("keeps the first dismissal time and the other preferences when the tour is dismissed again", async () => {
    const db = getDb();
    const email = uniqueEmail("tour-again");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new PreferencesRepository(db, testUser);
    await repository.setTheme("terminal");

    await repository.dismissTour();
    const [first] = await db
      .select({ at: preferences.tourDismissedAt })
      .from(preferences)
      .where(eq(preferences.userId, testUser.id));
    await repository.dismissTour();
    const [second] = await db
      .select({ at: preferences.tourDismissedAt })
      .from(preferences)
      .where(eq(preferences.userId, testUser.id));

    expect(first?.at).toBeInstanceOf(Date);
    expect(second?.at).toEqual(first?.at);
    expect(await repository.find()).toEqual({
      theme: "terminal",
      layout: "workspace",
      railCollapsed: false,
      tourDismissed: true,
      assetTourDismissed: false,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
  });

  it("user A dismissing the asset tour leaves user B's asset tour pending", async () => {
    const db = getDb();
    const emailA = uniqueEmail("asset-tour-a");
    const emailB = uniqueEmail("asset-tour-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    await new PreferencesRepository(db, userB).setTheme("amplo");

    await new PreferencesRepository(db, userA).dismissAssetTour();

    expect((await new PreferencesRepository(db, userA).find()).assetTourDismissed).toBe(true);
    expect(await new PreferencesRepository(db, userB).find()).toEqual({
      theme: "amplo",
      layout: "workspace",
      railCollapsed: false,
      tourDismissed: false,
      assetTourDismissed: false,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
  });

  it("keeps the first dismissal time of the asset tour independently of the main tour", async () => {
    const db = getDb();
    const email = uniqueEmail("asset-tour-again");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new PreferencesRepository(db, testUser);
    await repository.dismissTour();

    await repository.dismissAssetTour();
    const [first] = await db
      .select({ at: preferences.assetTourDismissedAt })
      .from(preferences)
      .where(eq(preferences.userId, testUser.id));
    await repository.dismissAssetTour();
    const [second] = await db
      .select({ at: preferences.assetTourDismissedAt })
      .from(preferences)
      .where(eq(preferences.userId, testUser.id));

    expect(first?.at).toBeInstanceOf(Date);
    expect(second?.at).toEqual(first?.at);
    expect(await repository.find()).toEqual({
      theme: "instrumento",
      layout: "workspace",
      railCollapsed: false,
      tourDismissed: true,
      assetTourDismissed: true,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
  });

  it("defaults to instrumento and an expanded rail before any preference is stored", async () => {
    const db = getDb();
    const email = uniqueEmail("default");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    const result = await new PreferencesRepository(db, testUser).find();

    expect(result).toEqual({
      theme: "instrumento",
      layout: "workspace",
      railCollapsed: false,
      tourDismissed: false,
      assetTourDismissed: false,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
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
    expect(result).toEqual({
      theme: "amplo",
      layout: "workspace",
      railCollapsed: true,
      tourDismissed: false,
      assetTourDismissed: false,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
  });

  it("persists a concurrent theme change and rail toggle without one clobbering the other", async () => {
    const db = getDb();
    const email = uniqueEmail("concurrent");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new PreferencesRepository(db, testUser);

    await Promise.all([repository.setTheme("terminal"), repository.setRailCollapsed(true)]);

    const result = await repository.find();
    expect(result).toEqual({
      theme: "terminal",
      layout: "workspace",
      railCollapsed: true,
      tourDismissed: false,
      assetTourDismissed: false,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
  });

  it("falls back to the default theme when the stored value is out of the enum", async () => {
    const db = getDb();
    const email = uniqueEmail("out-of-enum");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    await db.insert(preferences).values({ userId: testUser.id, theme: "cyberpunk" });

    const result = await new PreferencesRepository(db, testUser).find();
    expect(result.theme).toBe("instrumento");
  });

  it("user A switching to the studio layout leaves user B on workspace", async () => {
    const db = getDb();
    const emailA = uniqueEmail("layout-a");
    const emailB = uniqueEmail("layout-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    await new PreferencesRepository(db, userB).setTheme("papel");

    await new PreferencesRepository(db, userA).setLayout("studio");

    expect((await new PreferencesRepository(db, userA).find()).layout).toBe("studio");
    expect(await new PreferencesRepository(db, userB).find()).toEqual({
      theme: "papel",
      layout: "workspace",
      railCollapsed: false,
      tourDismissed: false,
      assetTourDismissed: false,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
  });

  it("persists the layout independently of the theme and the rail", async () => {
    const db = getDb();
    const email = uniqueEmail("layout");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new PreferencesRepository(db, testUser);

    await repository.setTheme("ouro-negro");
    await repository.setRailCollapsed(true);
    await repository.setLayout("studio");

    expect(await repository.find()).toEqual({
      theme: "ouro-negro",
      layout: "studio",
      railCollapsed: true,
      tourDismissed: false,
      assetTourDismissed: false,
      suggestionArchive: { enabled: false, afterMinutes: 1440 },
    });
  });

  it("falls back to the workspace layout when the stored value is out of the enum", async () => {
    const db = getDb();
    const email = uniqueEmail("layout-out-of-enum");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    await db.insert(preferences).values({ userId: testUser.id, layout: "cockpit" });

    expect((await new PreferencesRepository(db, testUser).find()).layout).toBe("workspace");
  });

  it("persists the suggestion archive per user, and turning it off keeps the chosen delay", async () => {
    const db = getDb();
    const emailA = uniqueEmail("archive-a");
    const emailB = uniqueEmail("archive-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const repositoryA = new PreferencesRepository(db, userA);
    await new PreferencesRepository(db, userB).setTheme("amplo");

    await repositoryA.setSuggestionArchive({ enabled: true, afterMinutes: 90 });

    expect((await repositoryA.find()).suggestionArchive).toEqual({
      enabled: true,
      afterMinutes: 90,
    });
    expect((await new PreferencesRepository(db, userB).find()).suggestionArchive).toEqual({
      enabled: false,
      afterMinutes: 1440,
    });
    const [row] = await db
      .select({
        enabled: preferences.suggestionArchiveEnabled,
        minutes: preferences.suggestionArchiveAfterMinutes,
      })
      .from(preferences)
      .where(eq(preferences.userId, userA.id));
    expect(row).toEqual({ enabled: true, minutes: 90 });

    await repositoryA.setSuggestionArchive({ enabled: false, afterMinutes: 90 });
    expect((await repositoryA.find()).suggestionArchive).toEqual({
      enabled: false,
      afterMinutes: 90,
    });
    expect((await repositoryA.find()).theme).toBe("instrumento");
  });

  it("rejects an archive delay outside one minute to one year at the database", async () => {
    const db = getDb();
    const email = uniqueEmail("archive-check");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    await expect(
      db.insert(preferences).values({ userId: testUser.id, suggestionArchiveAfterMinutes: 0 }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(preferences)
        .values({ userId: testUser.id, suggestionArchiveAfterMinutes: 525_601 }),
    ).rejects.toThrow();
  });
});
