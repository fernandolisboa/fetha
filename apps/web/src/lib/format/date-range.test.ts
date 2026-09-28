import { describe, expect, it } from "vitest";

import { formatDateRange } from "./date-range";

describe("formatDateRange", () => {
  it("shows the shared date once and both local times when the range stays in one day", () => {
    const first = new Date("2026-09-28T17:02:00.000Z");
    const last = new Date("2026-09-28T17:35:00.000Z");
    expect(formatDateRange(first, last)).toBe("28/09/2026 14:02 – 14:35");
  });

  it("shows a full date-time on both ends when the range spans local midnight", () => {
    const first = new Date("2026-09-27T02:58:00.000Z");
    const last = new Date("2026-09-28T03:03:00.000Z");
    expect(formatDateRange(first, last)).toBe("26/09/2026 23:58 – 28/09/2026 00:03");
  });

  it("returns a single moment on both ends when first equals last", () => {
    const at = new Date("2026-09-28T17:02:00.000Z");
    expect(formatDateRange(at, at)).toBe("28/09/2026 14:02 – 14:02");
  });
});
