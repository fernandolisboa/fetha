import { describe, expect, it } from "vitest";

import { instrumentHref, mergeSearchOutcomes, strategyHref } from "./search";

describe("mergeSearchOutcomes", () => {
  it("merges two ok outcomes into one result set", () => {
    const merged = mergeSearchOutcomes(
      { status: "ok", results: [{ ticker: "PETR4" }] },
      { status: "ok", results: [{ id: "s1", name: "Estratégia" }] },
    );
    expect(merged).toEqual({
      kind: "ok",
      instruments: [{ ticker: "PETR4" }],
      strategies: [{ id: "s1", name: "Estratégia" }],
    });
  });

  it("is rate_limited when the instrument search alone was throttled", () => {
    const merged = mergeSearchOutcomes(
      { status: "error", error: "rate_limited" },
      { status: "ok", results: [] },
    );
    expect(merged).toEqual({ kind: "rate_limited" });
  });

  it("is rate_limited when the strategy search alone was throttled", () => {
    const merged = mergeSearchOutcomes(
      { status: "ok", results: [] },
      { status: "error", error: "rate_limited" },
    );
    expect(merged).toEqual({ kind: "rate_limited" });
  });

  it("is rate_limited when both searches were throttled", () => {
    const merged = mergeSearchOutcomes(
      { status: "error", error: "rate_limited" },
      { status: "error", error: "rate_limited" },
    );
    expect(merged).toEqual({ kind: "rate_limited" });
  });
});

describe("instrumentHref", () => {
  it("builds the instrument page href", () => {
    expect(instrumentHref("PETR4")).toBe("/ativos/PETR4");
  });

  it("encodes characters unsafe in a URL segment", () => {
    expect(instrumentHref("PE R4")).toBe("/ativos/PE%20R4");
  });
});

describe("strategyHref", () => {
  it("builds the strategy page href", () => {
    expect(strategyHref("abc-123")).toBe("/estrategias/abc-123");
  });

  it("encodes characters unsafe in a URL segment", () => {
    expect(strategyHref("id/with slash")).toBe("/estrategias/id%2Fwith%20slash");
  });
});
