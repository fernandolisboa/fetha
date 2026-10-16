import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";

import { AiSettingsRepository } from "./ai-settings-repository";

const SECRET_A = "secret-for-user-a-0123456789-abcdefghijklmnop";

function uniqueEmail(label: string): string {
  return `fetha-ai-settings-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<{ id: string }> {
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
    .returning({ id: user.id });
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

describe("AiSettingsRepository isolation", () => {
  it("user A cannot read or overwrite user B's model families", async () => {
    const db = getDb();
    const emailA = uniqueEmail("families-a");
    const emailB = uniqueEmail("families-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new AiSettingsRepository(db, userA).setModelFamily("signal", "haiku");
    await new AiSettingsRepository(db, userB).setModelFamily("signal", "opus");

    expect(await new AiSettingsRepository(db, userA).getModelFamilies()).toEqual({
      signal: "haiku",
    });
    expect(await new AiSettingsRepository(db, userB).getModelFamilies()).toEqual({
      signal: "opus",
    });
  });

  it("user A cannot read, use or clear user B's API key", async () => {
    const db = getDb();
    const emailA = uniqueEmail("key-a");
    const emailB = uniqueEmail("key-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new AiSettingsRepository(db, userB).saveApiKey(
      "sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      SECRET_A,
    );

    const aOwnKey = await new AiSettingsRepository(db, userA).readOwnApiKey(SECRET_A);
    expect(aOwnKey).toEqual({ status: "none" });
    const aStatus = await new AiSettingsRepository(db, userA).getApiKeyStatus(SECRET_A);
    expect(aStatus).toEqual({ configured: false, last4: null, updatedAt: null, readable: true });

    await new AiSettingsRepository(db, userA).removeApiKey();
    const bStatusAfterAsRemoval = await new AiSettingsRepository(db, userB).getApiKeyStatus(
      SECRET_A,
    );
    expect(bStatusAfterAsRemoval.configured).toBe(true);
  });

  it("stores and reads back an own API key, keyed by this user's id as AAD", async () => {
    const db = getDb();
    const email = uniqueEmail("roundtrip");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new AiSettingsRepository(db, testUser);
    const key = "sk-ant-api03-zzzzzzzzzzzzzzzzzzzzzzzzzzzz";

    await repository.saveApiKey(key, SECRET_A);

    expect(await repository.readOwnApiKey(SECRET_A)).toEqual({ status: "ok", key });
    const status = await repository.getApiKeyStatus(SECRET_A);
    expect(status.updatedAt).toBeInstanceOf(Date);
    expect({ ...status, updatedAt: null }).toEqual({
      configured: true,
      last4: "zzzz",
      updatedAt: null,
      readable: true,
    });
  });

  it("treats a key that fails to decrypt (e.g. after a secret rotation) as unreadable, not as no key", async () => {
    const db = getDb();
    const email = uniqueEmail("rotated");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new AiSettingsRepository(db, testUser);
    await repository.saveApiKey("sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaa", SECRET_A);

    const rotatedSecret = "a-rotated-secret-9876543210-zyxwvutsrqponml";
    expect(await repository.readOwnApiKey(rotatedSecret)).toEqual({ status: "unreadable" });
    expect((await repository.getApiKeyStatus(rotatedSecret)).readable).toBe(false);
  });

  it("removes an own API key without touching model families", async () => {
    const db = getDb();
    const email = uniqueEmail("remove");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new AiSettingsRepository(db, testUser);
    await repository.setModelFamily("signal", "haiku");
    await repository.saveApiKey("sk-ant-api03-cccccccccccccccccccccccccccc", SECRET_A);

    await repository.removeApiKey();

    expect(await repository.readOwnApiKey(SECRET_A)).toEqual({ status: "none" });
    expect(await repository.getModelFamilies()).toEqual({ signal: "haiku" });
  });

  it("merges concurrent setModelFamily calls for different kinds instead of losing one", async () => {
    const db = getDb();
    const email = uniqueEmail("concurrent");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new AiSettingsRepository(db, testUser);

    await Promise.all([
      repository.setModelFamily("signal", "haiku"),
      repository.setModelFamily("contemplated_operation", "opus"),
      repository.setModelFamily("held_operation", "sonnet"),
    ]);

    expect(await repository.getModelFamilies()).toEqual({
      signal: "haiku",
      contemplated_operation: "opus",
      held_operation: "sonnet",
    });
  });

  it("defaults to no stored families and no configured key", async () => {
    const db = getDb();
    const email = uniqueEmail("default");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new AiSettingsRepository(db, testUser);

    expect(await repository.getModelFamilies()).toEqual({});
    expect(await repository.getApiKeyStatus(SECRET_A)).toEqual({
      configured: false,
      last4: null,
      updatedAt: null,
      readable: true,
    });
  });
});
