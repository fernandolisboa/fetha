import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { instantMs } from "./instant";
import { lastVisibleByAsOfString, latestVisibleIndexed, rowsWithKey } from "./view-index";
import { latestVisible } from "./visible";

type Row = { id: number; key: string; asOf: string };

// The same instant in two spellings, so a draw can make asOf strings and instants disagree.
const asOfSpellings = [
  "2024-01-02T20:00:00.000Z",
  "2024-01-02T17:00:00.000-03:00",
  "2024-01-03T20:00:00.000Z",
  "2024-01-03T17:00:00.000-03:00",
  "2024-01-04T20:00:00.000Z",
  "not an instant",
];

const rowsArbitrary = (spellings: readonly string[]) =>
  fc
    .array(fc.record({ key: fc.constantFrom("A", "B"), asOf: fc.constantFrom(...spellings) }), {
      maxLength: 12,
    })
    .map((rows) => rows.map((row, id): Row => ({ id, ...row })));

const atArbitrary = fc.constantFrom(
  "2024-01-01T20:00:00.000Z",
  "2024-01-02T20:00:00.000Z",
  "2024-01-03T18:00:00.000Z",
  "2024-01-05T20:00:00.000Z",
  "not an instant",
);

const keyOf = (row: Row): string | null => (row.key === "B" && row.id % 3 === 0 ? null : row.key);

function stringOrderReference(rows: readonly Row[], at: string): Row | null {
  return (
    rows
      .filter((row) => instantMs(row.asOf) - instantMs(at) <= 0)
      .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0))
      .at(-1) ?? null
  );
}

describe("view-index (#58)", () => {
  it("rowsWithKey returns filter()'s rows in input order, leaving null keys out, built once per array", () => {
    fc.assert(
      fc.property(rowsArbitrary(asOfSpellings), fc.constantFrom("A", "B", "C"), (rows, key) => {
        const expected = rows.filter((row) => keyOf(row) === key);
        expect(rowsWithKey(rows, keyOf, key)).toEqual(expected);
        expect(rowsWithKey(rows, keyOf, key)).toBe(rowsWithKey(rows, keyOf, key));
      }),
    );
  });

  it("latestVisibleIndexed returns latestVisible's row, ties and unparseable instants included", () => {
    fc.assert(
      fc.property(rowsArbitrary(asOfSpellings), atArbitrary, (rows, at) => {
        expect(latestVisibleIndexed(rows, at)).toBe(latestVisible(rows, at));
      }),
    );
  });

  it("lastVisibleByAsOfString returns the last row of the visible rows sorted by asOf string", () => {
    fc.assert(
      fc.property(rowsArbitrary(asOfSpellings), atArbitrary, (rows, at) => {
        expect(lastVisibleByAsOfString(rows, at)).toBe(stringOrderReference(rows, at));
      }),
    );
  });

  it("answers from the index when every asOf is spelled canonically", () => {
    const canonical = asOfSpellings.filter((spelling) => spelling.endsWith("Z"));
    fc.assert(
      fc.property(rowsArbitrary(canonical), atArbitrary, (rows, at) => {
        expect(lastVisibleByAsOfString(rows, at)).toBe(stringOrderReference(rows, at));
      }),
    );
  });
});
