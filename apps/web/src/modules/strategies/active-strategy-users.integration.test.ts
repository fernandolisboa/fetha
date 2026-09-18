import { afterEach, describe, expect, it } from "vitest";
import type { DecimalString, StrategyDefinition } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";

import { activeStrategyUserIds } from "./active-strategy-users";
import { StrategiesRepository } from "./strategies-repository";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function uniqueEmail(label: string): string {
  return `fetha-active-strategy-users-${label}-${crypto.randomUUID()}@example.com`;
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

function alwaysFiringDefinition(): StrategyDefinition {
  return {
    name: "Sempre dispara",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
    exit: [],
    adjustments: [],
  };
}

async function insertActiveUser(label: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail(label);
  const owner = await insertBareUser(email);
  const strategy = await new StrategiesRepository(getDb(), owner).createWithVersion(
    alwaysFiringDefinition(),
  );
  await new StrategiesRepository(getDb(), owner).setActive(strategy.id, true);
  return { id: owner.id, email };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("activeStrategyUserIds", () => {
  it("orders results deterministically (ascending user id) regardless of insertion order", async () => {
    const a = await insertActiveUser("a");
    const b = await insertActiveUser("b");
    const c = await insertActiveUser("c");
    createdEmails.push(a.email, b.email, c.email);
    const ids = [a.id, b.id, c.id];

    const first = (await activeStrategyUserIds(getDb())).filter((id) => ids.includes(id));
    const second = (await activeStrategyUserIds(getDb())).filter((id) => ids.includes(id));

    expect(first).toEqual(second);
    expect(first).toEqual([...first].sort());
  });

  it("rotates the starting point for a different rotate key without dropping or duplicating users", async () => {
    const a = await insertActiveUser("a");
    const b = await insertActiveUser("b");
    const c = await insertActiveUser("c");
    createdEmails.push(a.email, b.email, c.email);
    const ids = new Set([a.id, b.id, c.id]);

    const unrotated = (await activeStrategyUserIds(getDb())).filter((id) => ids.has(id));

    let rotated: string[] = [];
    for (const key of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]) {
      const candidate = (await activeStrategyUserIds(getDb(), key)).filter((id) => ids.has(id));
      expect(new Set(candidate)).toEqual(ids);
      if (candidate[0] !== unrotated[0]) {
        rotated = candidate;
        break;
      }
    }

    expect(rotated.length).toBe(3);
    expect(rotated).not.toEqual(unrotated);
    expect(new Set(rotated)).toEqual(new Set(unrotated));
  });
});
