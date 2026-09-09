import { describe, expect, it } from "vitest";
import { sortUnique } from "./order";

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
