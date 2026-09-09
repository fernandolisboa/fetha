import { describe, expect, it } from "vitest";
import { codeUnitCompare, sortedEntries, sortUnique } from "./order";

type Row = { key: string; order: number; value: number };

const byKey = (row: Row): string => row.key;
const byOrder = (a: Row, b: Row): number => a.order - b.order;

describe("sortUnique", () => {
  it("sorts rows by the comparator regardless of input order", () => {
    const rows: Row[] = [
      { key: "b", order: 2, value: 1 },
      { key: "a", order: 1, value: 2 },
      { key: "c", order: 3, value: 3 },
    ];
    const result = sortUnique(rows, byKey, byOrder);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((r) => r.key)).toEqual(["a", "b", "c"]);
    }
  });

  it("is invariant to the input permutation", () => {
    const b: Row = { key: "b", order: 2, value: 1 };
    const a: Row = { key: "a", order: 1, value: 2 };
    const c: Row = { key: "c", order: 3, value: 3 };
    const rows: Row[] = [b, a, c];
    const shuffled = [c, a, b];
    const first = sortUnique(rows, byKey, byOrder);
    const second = sortUnique(shuffled, byKey, byOrder);
    expect(second).toEqual(first);
  });

  it("rejects duplicate keys as invalid", () => {
    const rows: Row[] = [
      { key: "a", order: 1, value: 1 },
      { key: "a", order: 1, value: 2 },
    ];
    const result = sortUnique(rows, byKey, byOrder);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.duplicateKey).toBe("a");
    }
  });

  it("accepts an empty array", () => {
    const result = sortUnique<Row>([], byKey, byOrder);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});

describe("codeUnitCompare", () => {
  it("orders strictly by UTF-16 code unit, not by locale collation: uppercase before lowercase", () => {
    expect(codeUnitCompare("A", "a")).toBeLessThan(0);
    expect(codeUnitCompare("Z", "a")).toBeLessThan(0);
    expect(codeUnitCompare("a", "A")).toBeGreaterThan(0);
  });

  it("compares digit strings lexicographically by code unit, not numerically", () => {
    expect(codeUnitCompare("10", "9")).toBeLessThan(0);
  });

  it("is zero for equal strings", () => {
    expect(codeUnitCompare("ABEV3", "ABEV3")).toBe(0);
  });

  it("is deterministic and produces the same order regardless of the runtime locale", () => {
    const input = ["b", "A", "Z", "10", "9", "a"];
    expect([...input].sort(codeUnitCompare)).toEqual(["10", "9", "A", "Z", "a", "b"]);
  });
});

describe("sortedEntries", () => {
  it("orders map entries by code unit, uppercase before lowercase", () => {
    const counts = new Map<string, number>([
      ["b", 1],
      ["A", 2],
      ["a", 3],
    ]);
    expect(sortedEntries(counts).map(([key]) => key)).toEqual(["A", "a", "b"]);
  });
});
