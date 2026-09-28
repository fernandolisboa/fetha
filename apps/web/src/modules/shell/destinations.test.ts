import { describe, expect, it } from "vitest";

import { formatUnreadCount, isActiveDestination } from "./destinations";

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

describe("formatUnreadCount", () => {
  it("shows up to two digits and caps past them", () => {
    expect(formatUnreadCount(7)).toBe("7");
    expect(formatUnreadCount(99)).toBe("99");
    expect(formatUnreadCount(100)).toBe("99+");
  });
});
