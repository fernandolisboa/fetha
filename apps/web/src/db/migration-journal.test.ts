import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const journal = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)), "utf8"),
) as { entries: { idx: number; when: number; tag: string }[] };

// drizzle-kit applies a journal entry only when its `when` is greater than
// the latest applied migration's; an entry rebased behind an already-applied
// one is skipped silently in production while fresh CI databases apply it.
describe("drizzle migration journal", () => {
  it("numbers entries consecutively from zero", () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it("keeps `when` strictly increasing so no entry is skipped on an existing database", () => {
    const whens = journal.entries.map((entry) => entry.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(new Set(whens).size).toBe(whens.length);
  });
});
