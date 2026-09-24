import { describe, expect, it } from "vitest";

import { deriveDefaultHorizon } from "./horizon";

describe("deriveDefaultHorizon", () => {
  it("returns the option leg's expiry for a single-leg option structure", () => {
    const horizon = deriveDefaultHorizon([{ role: "call", expiry: "2026-11-20" }]);
    expect(horizon).toBe("2026-11-20");
  });

  it("returns the shared expiry when several option legs agree (ADR-0014 Q43)", () => {
    const horizon = deriveDefaultHorizon([
      { role: "call", expiry: "2026-11-20" },
      { role: "put", expiry: "2026-11-20" },
    ]);
    expect(horizon).toBe("2026-11-20");
  });

  it("returns the option leg's expiry even next to a stock leg (a collar)", () => {
    const horizon = deriveDefaultHorizon([
      { role: "stock", expiry: null },
      { role: "put", expiry: "2026-12-18" },
    ]);
    expect(horizon).toBe("2026-12-18");
  });

  it("returns null for a stock-only leg set: there is no default", () => {
    const horizon = deriveDefaultHorizon([{ role: "stock", expiry: null }]);
    expect(horizon).toBeNull();
  });

  it("returns null for an empty leg list", () => {
    expect(deriveDefaultHorizon([])).toBeNull();
  });

  it("returns null when the option leg's expiry could not be resolved (a data gap)", () => {
    expect(deriveDefaultHorizon([{ role: "call", expiry: null }])).toBeNull();
  });
});
