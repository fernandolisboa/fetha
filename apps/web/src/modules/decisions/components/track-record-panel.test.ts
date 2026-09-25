import { describe, expect, it } from "vitest";

import { isDegenerateChartDomain } from "./track-record-panel";

describe("isDegenerateChartDomain", () => {
  it("is degenerate for zero points", () => {
    expect(isDegenerateChartDomain([])).toBe(true);
  });

  it("is degenerate for a single point", () => {
    expect(isDegenerateChartDomain([{ at: new Date("2026-09-08T12:00:00.000Z") }])).toBe(true);
  });

  it("is degenerate when every point shares the same horizon instant (round 3 item 8)", () => {
    const at = new Date("2026-09-08T12:00:00.000Z");
    expect(isDegenerateChartDomain([{ at }, { at }, { at }])).toBe(true);
  });

  it("is not degenerate when at least two points differ", () => {
    expect(
      isDegenerateChartDomain([
        { at: new Date("2026-09-08T12:00:00.000Z") },
        { at: new Date("2026-09-09T12:00:00.000Z") },
      ]),
    ).toBe(false);
  });
});
