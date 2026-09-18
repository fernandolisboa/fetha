import { afterEach, describe, expect, it } from "vitest";
import type { RiskProfile } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";

import { RiskProfileRepository } from "./risk-profile-repository";

function uniqueEmail(label: string): string {
  return `fetha-risk-profile-${label}-${crypto.randomUUID()}@example.com`;
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

function profile(declaredCapital: number): RiskProfile {
  return {
    declaredCapital,
    limits: {
      maxLossPerOperation: "0.02" as RiskProfile["limits"]["maxLossPerOperation"],
      maxExposurePerOperation: "0.1" as RiskProfile["limits"]["maxExposurePerOperation"],
      maxOpenOperations: 5,
      maxPremiumBought: "0.05" as RiskProfile["limits"]["maxPremiumBought"],
    },
  } as RiskProfile;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("RiskProfileRepository isolation", () => {
  it("user A cannot read or overwrite user B's risk profile", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);

    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new RiskProfileRepository(db, userA).declare(profile(10_000_00));
    await new RiskProfileRepository(db, userB).declare(profile(50_000_00));

    const currentA = await new RiskProfileRepository(db, userA).current();
    const currentB = await new RiskProfileRepository(db, userB).current();

    expect(currentA?.declaredCapital).toBe(10_000_00);
    expect(currentB?.declaredCapital).toBe(50_000_00);
  });

  it("returns null before any profile is declared", async () => {
    const db = getDb();
    const email = uniqueEmail("none");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    const current = await new RiskProfileRepository(db, testUser).current();

    expect(current).toBeNull();
  });

  it("keeps history append-only: the current profile is always the latest declared", async () => {
    const db = getDb();
    const email = uniqueEmail("history");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new RiskProfileRepository(db, testUser);

    await repository.declare(profile(10_000_00));
    await repository.declare(profile(20_000_00));

    const current = await repository.current();
    const history = await repository.history();

    expect(current?.declaredCapital).toBe(20_000_00);
    expect(history).toHaveLength(2);
    expect(history[0]?.profile.declaredCapital).toBe(20_000_00);
    expect(history[1]?.profile.declaredCapital).toBe(10_000_00);
  });
});
