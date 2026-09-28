import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DecimalString, StrategyDefinition } from "@fetha/contracts";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { strategies, strategyVersions } from "./schema";
import { deleteTestUser } from "@/db/test/cleanup";

import {
  MAX_STRATEGIES_PER_USER,
  MAX_VERSIONS_PER_STRATEGY,
  StrategiesRepository,
  StrategyArchivedError,
  StrategyLimitReachedError,
  StrategyNotFoundError,
  StrategyNotSharedError,
  StrategyVersionLimitError,
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
    const copy = await copierRepository.copyShared(created.id);

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
      new StrategiesRepository(db, copier).copyShared(created.id),
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

    await expect(new StrategiesRepository(db, owner).copyShared(created.id)).rejects.toBeInstanceOf(
      StrategyNotSharedError,
    );
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

describe("StrategiesRepository version cap (#147)", () => {
  it("refuses a version beyond the cap and keeps the strategy unchanged", async () => {
    const db = getDb();
    const email = uniqueEmail("version-cap");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);
    const created = await repository.createWithVersion(definition({ name: "Cap" }));
    const [first] = created.versions;
    if (!first) throw new Error("expected a version");
    await db.insert(strategyVersions).values(
      Array.from({ length: MAX_VERSIONS_PER_STRATEGY - 1 }, (_, index) => ({
        strategyId: created.id,
        versionNumber: index + 2,
        definition: first.definition,
        definitionDigest: `digest-${String(index + 2)}`,
      })),
    );

    await expect(
      repository.addVersion(created.id, definition({ name: "One too many" })),
    ).rejects.toBeInstanceOf(StrategyVersionLimitError);

    const after = await repository.findMine(created.id);
    expect(after.versions).toHaveLength(MAX_VERSIONS_PER_STRATEGY);
    expect(after.name).toBe("Cap");
  });
});

describe("StrategiesRepository strategy cap (#160)", () => {
  async function fillToOneBelowCap(db: ReturnType<typeof getDb>, ownerId: string): Promise<void> {
    await db.insert(strategies).values(
      Array.from({ length: MAX_STRATEGIES_PER_USER - 1 }, (_, index) => ({
        userId: ownerId,
        name: `Bulk ${String(index)}`,
        visibility: "private" as const,
      })),
    );
  }

  async function countMine(db: ReturnType<typeof getDb>, ownerId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(strategies)
      .where(eq(strategies.userId, ownerId));
    return row?.count ?? 0;
  }

  it("refuses create beyond the cap and keeps the user's count unchanged", async () => {
    const db = getDb();
    const email = uniqueEmail("strategy-cap-create");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    await fillToOneBelowCap(db, owner.id);

    const repository = new StrategiesRepository(db, owner);
    await expect(
      repository.createWithVersion(definition({ name: "Last one" })),
    ).resolves.toBeDefined();
    await expect(
      repository.createWithVersion(definition({ name: "One too many" })),
    ).rejects.toBeInstanceOf(StrategyLimitReachedError);

    await expect(countMine(db, owner.id)).resolves.toBe(MAX_STRATEGIES_PER_USER);
  });

  it("refuses copyShared beyond the cap, counted inside the transaction", async () => {
    const db = getDb();
    const emailOwner = uniqueEmail("strategy-cap-owner");
    const emailCopier = uniqueEmail("strategy-cap-copier");
    createdEmails.push(emailOwner, emailCopier);
    const owner = await insertBareUser(emailOwner);
    const copier = await insertBareUser(emailCopier);

    const ownerRepository = new StrategiesRepository(db, owner);
    const created = await ownerRepository.createWithVersion(definition({ name: "Original" }));
    await ownerRepository.setVisibility(created.id, "shared");

    await fillToOneBelowCap(db, copier.id);
    const copierRepository = new StrategiesRepository(db, copier);
    await expect(copierRepository.copyShared(created.id)).resolves.toBeDefined();
    await expect(copierRepository.copyShared(created.id)).rejects.toBeInstanceOf(
      StrategyLimitReachedError,
    );

    await expect(countMine(db, copier.id)).resolves.toBe(MAX_STRATEGIES_PER_USER);
  });

  it("waits for the per-user lock before counting", async () => {
    const db = getDb();
    const email = uniqueEmail("strategy-cap-lock");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    await fillToOneBelowCap(db, owner.id);
    const repository = new StrategiesRepository(db, owner);

    let created: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`strategies:${owner.id}`}, 0))`,
      );
      created = repository.createWithVersion(definition({ name: "Waits for the lock" }));
      const outcome = await Promise.race([
        created.then(() => "created"),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve("waiting");
          }, 500);
        }),
      ]);
      expect(outcome).toBe("waiting");

      // Reaches the cap from inside the lock-holding transaction, before
      // releasing it: the waiter's own count (taken only once it acquires
      // the lock after this commits) must see this row, not the state as of
      // when it started waiting.
      await tx
        .insert(strategies)
        .values({ userId: owner.id, name: "Reaches the cap", visibility: "private" });
    });

    await expect(created).rejects.toBeInstanceOf(StrategyLimitReachedError);
    await expect(countMine(db, owner.id)).resolves.toBe(MAX_STRATEGIES_PER_USER);
  });

  it("admits at most the cap when creates race", async () => {
    const db = getDb();
    const email = uniqueEmail("strategy-cap-race");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    await fillToOneBelowCap(db, owner.id);
    const repository = new StrategiesRepository(db, owner);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        repository.createWithVersion(definition({ name: `Race ${String(index)}` })),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(StrategyLimitReachedError);
      }
    }
    await expect(countMine(db, owner.id)).resolves.toBe(MAX_STRATEGIES_PER_USER);
  });

  it("user B at cap does not block user A's create (isolation)", async () => {
    const db = getDb();
    const emailA = uniqueEmail("strategy-cap-a");
    const emailB = uniqueEmail("strategy-cap-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    await fillToOneBelowCap(db, userB.id);

    const repositoryB = new StrategiesRepository(db, userB);
    await repositoryB.createWithVersion(definition({ name: "B's last one" }));
    await expect(
      repositoryB.createWithVersion(definition({ name: "B over cap" })),
    ).rejects.toBeInstanceOf(StrategyLimitReachedError);

    const repositoryA = new StrategiesRepository(db, userA);
    await expect(
      repositoryA.createWithVersion(definition({ name: "A is unaffected" })),
    ).resolves.toBeDefined();
    const mineA = await repositoryA.listMine();
    expect(mineA).toHaveLength(1);
  });
});

describe("StrategiesRepository archive/unarchive (#170, docs/adr/0043)", () => {
  it("hides an archived strategy from listMine and shows it in listMineArchived", async () => {
    const db = getDb();
    const email = uniqueEmail("archive-list");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);
    const created = await repository.createWithVersion(definition({ name: "To archive" }));

    await repository.archive(created.id);

    expect((await repository.listMine()).map((s) => s.id)).not.toContain(created.id);
    expect((await repository.listMineArchived()).map((s) => s.id)).toContain(created.id);
  });

  it("archive deactivates the strategy", async () => {
    const db = getDb();
    const email = uniqueEmail("archive-deactivates");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);
    const created = await repository.createWithVersion(
      definition({ name: "Active then archived" }),
    );
    await repository.setActive(created.id, true);

    await repository.archive(created.id);

    const after = await repository.findMine(created.id);
    expect(after.active).toBe(false);
    expect(after.archivedAt).not.toBeNull();
    expect((await repository.listActiveDaily()).map((row) => row.strategyId)).not.toContain(
      created.id,
    );
  });

  it("archive is idempotent on an already-archived strategy", async () => {
    const db = getDb();
    const email = uniqueEmail("archive-idempotent");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);
    const created = await repository.createWithVersion(definition({ name: "Twice archived" }));

    await repository.archive(created.id);
    await expect(repository.archive(created.id)).resolves.toBeUndefined();

    const after = await repository.findMine(created.id);
    expect(after.archivedAt).not.toBeNull();
  });

  it("unarchive clears archivedAt without re-activating", async () => {
    const db = getDb();
    const email = uniqueEmail("unarchive-inactive");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);
    const created = await repository.createWithVersion(definition({ name: "Unarchive me" }));
    await repository.setActive(created.id, true);
    await repository.archive(created.id);

    await repository.unarchive(created.id);

    const after = await repository.findMine(created.id);
    expect(after.archivedAt).toBeNull();
    expect(after.active).toBe(false);
    expect((await repository.listMine()).map((s) => s.id)).toContain(created.id);
  });

  it("archived strategies do not count toward the cap: create succeeds at 200 with one archived", async () => {
    const db = getDb();
    const email = uniqueEmail("archive-cap-create");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);

    await db.insert(strategies).values(
      Array.from({ length: MAX_STRATEGIES_PER_USER }, (_, index) => ({
        userId: owner.id,
        name: `Bulk ${String(index)}`,
        visibility: "private" as const,
      })),
    );
    const [toArchive] = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(eq(strategies.userId, owner.id))
      .limit(1);
    if (!toArchive) throw new Error("expected a strategy to archive");
    await repository.archive(toArchive.id);

    await expect(
      repository.createWithVersion(definition({ name: "Room after archive" })),
    ).resolves.toBeDefined();
  });

  it("refuses unarchive at the cap and leaves the strategy archived", async () => {
    const db = getDb();
    const email = uniqueEmail("unarchive-at-cap");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);
    const created = await repository.createWithVersion(definition({ name: "Archived at cap" }));
    await repository.archive(created.id);

    await db.insert(strategies).values(
      Array.from({ length: MAX_STRATEGIES_PER_USER }, (_, index) => ({
        userId: owner.id,
        name: `Bulk ${String(index)}`,
        visibility: "private" as const,
      })),
    );

    await expect(repository.unarchive(created.id)).rejects.toBeInstanceOf(
      StrategyLimitReachedError,
    );
    const after = await repository.findMine(created.id);
    expect(after.archivedAt).not.toBeNull();
  });

  it("excludes an archived strategy from listShared and refuses copyShared on it", async () => {
    const db = getDb();
    const emailOwner = uniqueEmail("archive-shared-owner");
    const emailOther = uniqueEmail("archive-shared-other");
    createdEmails.push(emailOwner, emailOther);
    const owner = await insertBareUser(emailOwner);
    const other = await insertBareUser(emailOther);
    const ownerRepository = new StrategiesRepository(db, owner);
    const created = await ownerRepository.createWithVersion(
      definition({ name: "Shared then archived" }),
    );
    await ownerRepository.setVisibility(created.id, "shared");
    await ownerRepository.archive(created.id);

    const otherRepository = new StrategiesRepository(db, other);
    expect((await otherRepository.listShared()).map((s) => s.id)).not.toContain(created.id);
    await expect(otherRepository.copyShared(created.id)).rejects.toBeInstanceOf(
      StrategyNotFoundError,
    );
    await expect(ownerRepository.copyShared(created.id)).rejects.toBeInstanceOf(
      StrategyArchivedError,
    );
  });

  it("refuses addVersion, setActive(true) and share on an archived strategy", async () => {
    const db = getDb();
    const email = uniqueEmail("archive-read-only");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new StrategiesRepository(db, owner);
    const created = await repository.createWithVersion(
      definition({ name: "Read only once archived" }),
    );
    await repository.archive(created.id);

    await expect(
      repository.addVersion(created.id, definition({ name: "New version" })),
    ).rejects.toBeInstanceOf(StrategyArchivedError);
    await expect(repository.setActive(created.id, true)).rejects.toBeInstanceOf(
      StrategyArchivedError,
    );
    await expect(repository.setVisibility(created.id, "shared")).rejects.toBeInstanceOf(
      StrategyArchivedError,
    );
    await expect(repository.setActive(created.id, false)).resolves.toBeUndefined();
  });
});

describe("StrategiesRepository archive/unarchive isolation", () => {
  it("user A cannot archive or unarchive user B's strategy", async () => {
    const db = getDb();
    const emailA = uniqueEmail("archive-iso-a");
    const emailB = uniqueEmail("archive-iso-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const repositoryB = new StrategiesRepository(db, userB);
    const created = await repositoryB.createWithVersion(definition({ name: "B's strategy" }));

    const repositoryA = new StrategiesRepository(db, userA);
    await expect(repositoryA.archive(created.id)).rejects.toBeInstanceOf(StrategyNotFoundError);

    await repositoryB.archive(created.id);
    await expect(repositoryA.unarchive(created.id)).rejects.toBeInstanceOf(StrategyNotFoundError);

    const stillArchived = await repositoryB.findMine(created.id);
    expect(stillArchived.archivedAt).not.toBeNull();
  });

  it("user A's archived list never shows user B's archived strategies", async () => {
    const db = getDb();
    const emailA = uniqueEmail("archive-iso-list-a");
    const emailB = uniqueEmail("archive-iso-list-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const repositoryB = new StrategiesRepository(db, userB);
    const created = await repositoryB.createWithVersion(definition({ name: "B's archived" }));
    await repositoryB.archive(created.id);

    const repositoryA = new StrategiesRepository(db, userA);
    expect((await repositoryA.listMineArchived()).map((s) => s.id)).not.toContain(created.id);
  });
});
