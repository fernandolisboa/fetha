import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { structures } from "./schema";
import { eq } from "drizzle-orm";

import { StructuresRepository } from "./structures-repository";

const createdIds: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const id of createdIds.splice(0)) {
    await db.delete(structures).where(eq(structures.id, id));
  }
});

describe("StructuresRepository", () => {
  it("is readable by any caller regardless of user", async () => {
    const db = getDb();
    const id = `test-structure-${crypto.randomUUID()}`;
    createdIds.push(id);
    await db
      .insert(structures)
      .values({ id, name: "Estrutura de teste", legs: [{ role: "stock", side: "buy", ratio: 1 }] });

    const result = await new StructuresRepository(db).listAll();

    expect(result.some((structure) => structure.id === id)).toBe(true);
  });

  it("exposes no method that writes to the catalog", () => {
    const repository = new StructuresRepository(getDb());
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(repository));

    expect(methodNames).toEqual(["constructor", "listAll"]);
  });
});
