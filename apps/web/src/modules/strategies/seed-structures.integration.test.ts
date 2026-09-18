import { execFileSync } from "node:child_process";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { structures } from "./schema";

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

  it("is idempotent: running it twice leaves a single row per id", async () => {
    runSeed();
    runSeed();

    const rows = await getDb().select().from(structures).where(eq(structures.id, "stock"));

    expect(rows).toHaveLength(1);
  });
});
