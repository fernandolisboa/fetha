import { describe, expect, it } from "vitest";
import { latestVisible } from "./visible";

describe("latestVisible", () => {
  it("returns null when no row is visible at `at`", () => {
    expect(
      latestVisible([{ asOf: "2024-01-02T00:00:00.000Z" }], "2024-01-01T00:00:00.000Z"),
    ).toBeNull();
  });

  it("returns the single visible row", () => {
    const row = { asOf: "2024-01-01T00:00:00.000Z", value: 1 };
    expect(latestVisible([row], "2024-01-02T00:00:00.000Z")).toBe(row);
  });

  it("returns the later of two visible rows regardless of array order", () => {
    const earlier = { asOf: "2024-01-01T00:00:00.000Z", value: 1 };
    const later = { asOf: "2024-01-02T00:00:00.000Z", value: 2 };
    expect(latestVisible([earlier, later], "2024-01-03T00:00:00.000Z")).toBe(later);
    expect(latestVisible([later, earlier], "2024-01-03T00:00:00.000Z")).toBe(later);
  });
});
