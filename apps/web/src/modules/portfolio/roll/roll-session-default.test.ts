import { describe, expect, it } from "vitest";
import { sessionDateSchema } from "@fetha/contracts";

import { resolveRollSessionDefault } from "./roll-session-default";

const today = sessionDateSchema.parse("2026-11-23");
const latestOpenedSession = sessionDateSchema.parse("2026-11-20");

describe("resolveRollSessionDefault", () => {
  it("defaults to today once today's own session has opened", () => {
    const todaySession = { open: new Date("2026-11-23T13:00:00.000Z") };
    const now = new Date("2026-11-23T14:00:00.000Z");
    expect(resolveRollSessionDefault(today, todaySession, now, latestOpenedSession)).toBe(today);
  });

  it("falls back to the latest opened session on a Saturday, which has no session of its own", () => {
    const now = new Date("2026-11-21T14:00:00.000Z");
    expect(resolveRollSessionDefault(today, null, now, latestOpenedSession)).toBe(
      latestOpenedSession,
    );
  });

  it("falls back to the latest opened session on a weekday before B3's own open (13:00Z)", () => {
    const todaySession = { open: new Date("2026-11-23T13:00:00.000Z") };
    const now = new Date("2026-11-23T12:00:00.000Z");
    expect(resolveRollSessionDefault(today, todaySession, now, latestOpenedSession)).toBe(
      latestOpenedSession,
    );
  });

  it("falls back to today when there is no earlier opened session either", () => {
    const now = new Date("2026-11-21T14:00:00.000Z");
    expect(resolveRollSessionDefault(today, null, now, null)).toBe(today);
  });
});
