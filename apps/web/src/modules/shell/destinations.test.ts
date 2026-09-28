import { describe, expect, it } from "vitest";

import { isActiveDestination } from "./destinations";

describe("isActiveDestination", () => {
  it("marks a destination on its own page", () => {
    expect(isActiveDestination("/sinais", "/sinais")).toBe(true);
  });

  it("keeps a destination current on its sub-pages", () => {
    expect(isActiveDestination("/estrategias/abc/backtests/novo", "/estrategias")).toBe(true);
    expect(isActiveDestination("/carteira/nova-operacao", "/carteira")).toBe(true);
  });

  it("does not match a sibling path that only shares a prefix", () => {
    expect(isActiveDestination("/sinaisx", "/sinais")).toBe(false);
  });

  it("marks the watchlist only on the root", () => {
    expect(isActiveDestination("/", "/")).toBe(true);
    expect(isActiveDestination("/sinais", "/")).toBe(false);
    expect(isActiveDestination("/ativos/PETR4", "/")).toBe(false);
  });
});
