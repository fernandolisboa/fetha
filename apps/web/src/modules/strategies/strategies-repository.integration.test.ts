import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DecimalString, StrategyDefinition } from "@fetha/contracts";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { strategyVersions } from "./schema";
import { deleteTestUser } from "@/db/test/cleanup";

import {
  StrategiesRepository,
  StrategyLimitReachedError,
  StrategyNotFoundError,
  StrategyNotSharedError,
} from "./strategies-repository";

function uniqueEmail(label: string): string {
  return `fetha-strategies-${label}-${crypto.randomUUID()}@example.com`;
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

function definition(overrides: Partial<StrategyDefinition> = {}): StrategyDefinition {
  return {
    name: "SMA cruza acima",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
      comparator: ">",
      right: { kind: "price", field: "close" },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
    exit: [],
    adjustments: [],
    ...overrides,
  };
}

describe("StrategiesRepository isolation", () => {
  it("user A cannot read user B's private strategy", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const created = await new StrategiesRepository(db, userB).createWithVersion(
      definition({ name: "Estratégia da B" }),
    );

    await expect(new StrategiesRepository(db, userA).findMine(created.id)).rejects.toBeInstanceOf(
      StrategyNotFoundError,
    );
  });

  it("user A cannot add a version or change visibility on user B's strategy", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a2");
    const emailB = uniqueEmail("b2");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const created = await new StrategiesRepository(db, userB).createWithVersion(
      definition({ name: "Estratégia da B" }),
    );

    await expect(
      new StrategiesRepository(db, userA).addVersion(created.id, definition({ name: "Hack" })),
    ).rejects.toBeInstanceOf(StrategyNotFoundError);

    await expect(
      new StrategiesRepository(db, userA).setVisibility(created.id, "shared"),
    ).rejects.toBeInstanceOf(StrategyNotFoundError);

    const stillB = await new StrategiesRepository(db, userB).findMine(created.id);
    expect(stillB.versions).toHaveLength(1);
    expect(stillB.visibility).toBe("private");
    expect(stillB.name).toBe("Estratégia da B");
  });

  it("listMine only returns the caller's own strategies", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a3");
    const emailB = uniqueEmail("b3");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new StrategiesRepository(db, userA).createWithVersion(definition({ name: "A1" }));
    await new StrategiesRepository(db, userB).createWithVersion(definition({ name: "B1" }));

    const listA = await new StrategiesRepository(db, userA).listMine();
    expect(listA.map((s) => s.name)).toEqual(["A1"]);
  });
});

describe("StrategiesRepository immutability", () => {
  it("editing a strategy creates a new version and leaves the previous one unchanged", async () => {
    const db = getDb();
    const email = uniqueEmail("edit");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);

    const created = await repository.createWithVersion(definition({ name: "V1" }));
    expect(created.versions).toHaveLength(1);
    expect(created.versions[0]?.versionNumber).toBe(1);

    const edited = await repository.addVersion(
      created.id,
      definition({
        name: "V2",
        sizing: { kind: "fixed_fractional", fraction: decimalString("0.2") },
      }),
    );

    expect(edited.versions).toHaveLength(2);
    const [v1, v2] = edited.versions;
    expect(v1?.versionNumber).toBe(1);
    expect(v1?.definition.sizing).toEqual({
      kind: "fixed_fractional",
      fraction: decimalString("0.1"),
    });
    expect(v2?.versionNumber).toBe(2);
    expect(v2?.definition.sizing).toEqual({
      kind: "fixed_fractional",
      fraction: decimalString("0.2"),
    });
  });

  it("two concurrent addVersion calls on the same strategy produce distinct, sequential version numbers", async () => {
    const db = getDb();
    const email = uniqueEmail("concurrent");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);

    const created = await repository.createWithVersion(definition({ name: "V1" }));

    const [first, second] = await Promise.all([
      repository.addVersion(created.id, definition({ name: "V2" })),
      repository.addVersion(created.id, definition({ name: "V3" })),
    ]);

    const versionNumbers = [first, second]
      .map((result) => result.versions[result.versions.length - 1]?.versionNumber)
      .sort();
    expect(versionNumbers).toEqual([2, 3]);

    const final = await repository.findMine(created.id);
    expect(final.versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
  });

  it("the database refuses an UPDATE on strategy_versions, from any code path", async () => {
    const db = getDb();
    const email = uniqueEmail("trigger");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);

    const created = await repository.createWithVersion(definition({ name: "V1" }));
    const versionId = created.versions[0]?.id;
    if (!versionId) {
      throw new Error("expected a version to be created");
    }

    let caught: unknown;
    try {
      await db
        .update(strategyVersions)
        .set({ definitionDigest: "tampered" })
        .where(eq(strategyVersions.id, versionId));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const cause = caught instanceof Error ? caught.cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    expect(causeMessage).toMatch(/immutable/);

    const [row] = await db
      .select({ definitionDigest: strategyVersions.definitionDigest })
      .from(strategyVersions)
      .where(eq(strategyVersions.id, versionId));
    expect(row?.definitionDigest).not.toBe("tampered");
  });

  it("findMine parses each version's definition through strategyDefinitionSchema, rejecting a corrupt row", async () => {
    const db = getDb();
    const email = uniqueEmail("parse-on-read");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);

    const created = await repository.createWithVersion(definition({ name: "V1" }));

    await db.insert(strategyVersions).values({
      strategyId: created.id,
      versionNumber: 2,
      definition: { name: "corrupt" } as unknown as StrategyDefinition,
      definitionDigest: "irrelevant",
    });

    await expect(repository.findMine(created.id)).rejects.toThrow();
  });
});

describe("StrategiesRepository sharing and copy", () => {
  it("a shared strategy is readable by another user, a private one is not", async () => {
    const db = getDb();
    const emailOwner = uniqueEmail("owner");
    const emailOther = uniqueEmail("other");
    createdEmails.push(emailOwner, emailOther);
    const owner = await insertBareUser(emailOwner);
    const other = await insertBareUser(emailOther);

    const created = await new StrategiesRepository(db, owner).createWithVersion(
      definition({ name: "Trava de alta" }),
    );

    await expect(new StrategiesRepository(db, other).findShared(created.id)).rejects.toBeInstanceOf(
      StrategyNotFoundError,
    );

    await new StrategiesRepository(db, owner).setVisibility(created.id, "shared");

    const shared = await new StrategiesRepository(db, other).findShared(created.id);
    expect(shared.id).toBe(created.id);
    expect(shared.visibility).toBe("shared");
  });

  it("copying a shared strategy produces a private strategy with a fresh version lineage", async () => {
    const db = getDb();
    const emailOwner = uniqueEmail("owner2");
    const emailCopier = uniqueEmail("copier");
    createdEmails.push(emailOwner, emailCopier);
    const owner = await insertBareUser(emailOwner);
    const copier = await insertBareUser(emailCopier);

    const ownerRepository = new StrategiesRepository(db, owner);
    const created = await ownerRepository.createWithVersion(definition({ name: "Original" }));
    await ownerRepository.addVersion(created.id, definition({ name: "Original v2" }));
    await ownerRepository.setVisibility(created.id, "shared");

    const copierRepository = new StrategiesRepository(db, copier);
    const copy = await copierRepository.copyShared(created.id, 200);

    expect(copy.userId).toBe(copier.id);
    expect(copy.visibility).toBe("private");
    expect(copy.copiedFromStrategyId).toBe(created.id);
    expect(copy.versions).toHaveLength(1);
    expect(copy.versions[0]?.versionNumber).toBe(1);
    expect(copy.versions[0]?.definition.name).toBe("Original v2");

    const copyingAgainDoesNotAffectOriginal = await ownerRepository.findMine(created.id);
    expect(copyingAgainDoesNotAffectOriginal.versions).toHaveLength(2);
  });

  it("copying another user's private strategy reports not found, not not-shared (no existence oracle)", async () => {
    const db = getDb();
    const emailOwner = uniqueEmail("owner3");
    const emailCopier = uniqueEmail("copier3");
    createdEmails.push(emailOwner, emailCopier);
    const owner = await insertBareUser(emailOwner);
    const copier = await insertBareUser(emailCopier);

    const created = await new StrategiesRepository(db, owner).createWithVersion(
      definition({ name: "Privada" }),
    );

    await expect(
      new StrategiesRepository(db, copier).copyShared(created.id, 200),
    ).rejects.toBeInstanceOf(StrategyNotFoundError);
  });

  it("the owner copying their own private strategy gets a distinct not-shared error", async () => {
    const db = getDb();
    const emailOwner = uniqueEmail("owner3b");
    createdEmails.push(emailOwner);
    const owner = await insertBareUser(emailOwner);

    const created = await new StrategiesRepository(db, owner).createWithVersion(
      definition({ name: "Privada" }),
    );

    await expect(
      new StrategiesRepository(db, owner).copyShared(created.id, 200),
    ).rejects.toBeInstanceOf(StrategyNotSharedError);
  });

  it("copying refuses once the copier is at the strategy cap, counted inside the transaction", async () => {
    const db = getDb();
    const emailOwner = uniqueEmail("owner-cap");
    const emailCopier = uniqueEmail("copier-cap");
    createdEmails.push(emailOwner, emailCopier);
    const owner = await insertBareUser(emailOwner);
    const copier = await insertBareUser(emailCopier);

    const ownerRepository = new StrategiesRepository(db, owner);
    const created = await ownerRepository.createWithVersion(definition({ name: "Original" }));
    await ownerRepository.setVisibility(created.id, "shared");

    const copierRepository = new StrategiesRepository(db, copier);
    await copierRepository.createWithVersion(definition({ name: "Já existente" }));

    await expect(copierRepository.copyShared(created.id, 1)).rejects.toBeInstanceOf(
      StrategyLimitReachedError,
    );

    const copierStrategies = await copierRepository.listMine();
    expect(copierStrategies).toHaveLength(1);
  });

  it("listShared returns strategies from every user, not only the caller's", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a4");
    const emailB = uniqueEmail("b4");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const repoA = new StrategiesRepository(db, userA);
    const created = await repoA.createWithVersion(definition({ name: "Compartilhada por A" }));
    await repoA.setVisibility(created.id, "shared");

    const listedByB = await new StrategiesRepository(db, userB).listShared();
    expect(listedByB.map((s) => s.id)).toContain(created.id);
  });
});
