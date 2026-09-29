import { execFileSync } from "node:child_process";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { catalog } from "./catalog";
import { structures } from "./schema";
import { StructuresRepository } from "./structures-repository";

const scriptPath = path.resolve(import.meta.dirname, "../../../scripts/seed-structures.mjs");

function runSeed() {
  execFileSync("node", [scriptPath], {
    env: { ...process.env },
    stdio: "pipe",
  });
}

describe("seed-structures.mjs", () => {
  afterAll(runSeed);

  it("upserts the catalog row back to the script's definition after drift", async () => {
    const db = getDb();
    await db
      .update(structures)
      .set({ name: "Stale name", legs: [{ role: "stock", side: "sell", ratio: 2 }] })
      .where(eq(structures.id, "stock"));

    runSeed();

    const [row] = await db.select().from(structures).where(eq(structures.id, "stock"));

    expect(row?.name).toBe("Compra de ação");
    expect(row?.legs).toEqual([{ role: "stock", side: "buy", ratio: 1 }]);
  });

  it("writes every catalog entry as the structure it defines (#20)", async () => {
    runSeed();

    const seeded = new Map(
      (await new StructuresRepository(getDb()).listAll()).map((structure) => [
        structure.id,
        structure,
      ]),
    );

    for (const entry of catalog) {
      expect(seeded.get(entry.structure.id)).toEqual(entry.structure);
    }
  });

  it("is idempotent: running it twice leaves a single row per id", async () => {
    runSeed();
    runSeed();

    const rows = await getDb().select().from(structures).where(eq(structures.id, "stock"));

    expect(rows).toHaveLength(1);
  });
});
