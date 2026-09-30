import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { instantMs } from "./instant";
import {
  lastVisibleByAsOfString,
  latestSessionVersion,
  latestVisibleIndexed,
  rowsWithKey,
} from "./view-index";
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

describe("latestSessionVersion (#38)", () => {
  type Daily = { id: number; session: string; asOf: string };
  const hour = (h: number) => `2024-01-10T${String(h).padStart(2, "0")}:00:00.000Z`;
  const read = (rows: Daily[], at: string) =>
    latestSessionVersion(rows, at, latestVisibleIndexed)?.id ?? null;

  it("answers as `newest` does when no session is listed twice", () => {
    const rows: Daily[] = [
      { id: 0, session: "2024-01-02", asOf: hour(5) },
      { id: 1, session: "2024-01-01", asOf: hour(9) },
    ];
    expect(read(rows, hour(10))).toBe(1);
  });

  it("reads the session published last at its latest visible version, in any input order", () => {
    const rows: Daily[] = [
      { id: 0, session: "2024-01-01", asOf: hour(8) },
      { id: 1, session: "2024-01-01", asOf: hour(1) },
      { id: 2, session: "2024-01-02", asOf: hour(2) },
      { id: 3, session: "2024-01-02", asOf: hour(6) },
    ];
    for (const ordered of [rows, [...rows].reverse()]) {
      expect(read(ordered, hour(0))).toBeNull();
      expect(read(ordered, hour(1))).toBe(1);
      expect(read(ordered, hour(5))).toBe(2);
      expect(read(ordered, hour(7))).toBe(3);
      expect(read(ordered, hour(9))).toBe(3);
    }
  });

  it("breaks a tie on first publication by the later session", () => {
    const rows: Daily[] = [
      { id: 0, session: "2024-01-02", asOf: hour(1) },
      { id: 1, session: "2024-01-01", asOf: hour(1) },
      { id: 2, session: "2024-01-01", asOf: hour(3) },
    ];
    for (const ordered of [rows, [...rows].reverse()]) {
      expect(read(ordered, hour(4))).toBe(0);
    }
  });

  it("does not depend on input order when every asOf is distinct", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 20 }), { maxLength: 10 }),
        fc.array(fc.constantFrom("2024-01-01", "2024-01-02", "2024-01-03"), {
          minLength: 10,
          maxLength: 10,
        }),
        fc.integer({ min: 0, max: 21 }),
        (hours, sessions, atHour) => {
          const rows = hours.map((h, id): Daily => ({
            id,
            session: sessions[id] ?? "2024-01-01",
            asOf: hour(h),
          }));
          expect(read([...rows].reverse(), hour(atHour))).toBe(read(rows, hour(atHour)));
        },
      ),
    );
  });
});
