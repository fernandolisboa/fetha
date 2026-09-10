import { describe, expect, it } from "vitest";

import { describeCloseFreshness } from "./close-freshness";

describe("describeCloseFreshness", () => {
  it("labels the session that matches today in America/Sao_Paulo", () => {
    expect(describeCloseFreshness("2026-10-17", new Date("2026-10-17T21:05:00.000Z"))).toBe(
      "fechamento de hoje",
    );
  });

  it("labels the session that matches yesterday in America/Sao_Paulo", () => {
    expect(describeCloseFreshness("2026-10-16", new Date("2026-10-17T12:00:00.000Z"))).toBe(
      "fechamento de ontem",
    );
  });

  it("labels an older session with its date", () => {
    expect(describeCloseFreshness("2026-10-10", new Date("2026-10-17T12:00:00.000Z"))).toBe(
      "fechamento de 10/10/2026",
    );
  });

  it("uses the São Paulo calendar day, not the UTC day, near the day boundary", () => {
    // 2026-10-17T02:00:00Z is still 2026-10-16 23:00 in America/Sao_Paulo.
    expect(describeCloseFreshness("2026-10-16", new Date("2026-10-17T02:00:00.000Z"))).toBe(
      "fechamento de hoje",
    );
  });
});
