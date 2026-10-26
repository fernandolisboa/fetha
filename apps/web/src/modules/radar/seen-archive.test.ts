import { describe, expect, it } from "vitest";

import { splitSeenSuggestions } from "./seen-archive";

const now = new Date("2026-10-27T15:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("splitSeenSuggestions (docs/adr/0074)", () => {
  const suggestions = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("archives the ones seen at least the delay ago, keeping their order", () => {
    const firstSeen = new Map([
      ["a", hoursAgo(25)],
      ["b", hoursAgo(23)],
      ["c", hoursAgo(24)],
    ]);
    const split = splitSeenSuggestions(suggestions, firstSeen, 24, now);
    expect(ids(split.shown)).toEqual(["b"]);
    expect(ids(split.archivedSeen)).toEqual(["a", "c"]);
  });

  it("keeps a suggestion never seen, however long the delay has run", () => {
    const split = splitSeenSuggestions(suggestions, new Map([["a", hoursAgo(500)]]), 12, now);
    expect(ids(split.shown)).toEqual(["b", "c"]);
    expect(ids(split.archivedSeen)).toEqual(["a"]);
  });

  it("archives nothing when the viewer turned it off", () => {
    const firstSeen = new Map([["a", hoursAgo(500)]]);
    const split = splitSeenSuggestions(suggestions, firstSeen, null, now);
    expect(ids(split.shown)).toEqual(["a", "b", "c"]);
    expect(split.archivedSeen).toEqual([]);
  });
});
