import { describe, expect, it } from "vitest";

import type { AccessLogEntry } from "./access-log-repository";
import { groupAccessLog } from "./group-access-log";

const context = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140" };

function entry(
  id: string,
  overrides: Partial<AccessLogEntry> & Pick<AccessLogEntry, "occurredAt">,
): AccessLogEntry {
  return {
    id,
    event: "portfolio_read",
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    ...overrides,
  };
}

describe("groupAccessLog", () => {
  it("returns an empty list for an empty list", () => {
    expect(groupAccessLog([])).toEqual([]);
  });

  it("wraps a single entry in its own group", () => {
    const at = new Date("2026-09-28T14:02:00.000Z");
    const result = groupAccessLog([entry("1", { occurredAt: at })]);

    expect(result).toEqual([
      {
        event: "portfolio_read",
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        count: 1,
        first: at,
        last: at,
      },
    ]);
  });

  it("merges a consecutive run of the same event and origin into one group", () => {
    const newest = new Date("2026-09-28T14:35:00.000Z");
    const middle = new Date("2026-09-28T14:20:00.000Z");
    const oldest = new Date("2026-09-28T14:02:00.000Z");

    const result = groupAccessLog([
      entry("3", { occurredAt: newest }),
      entry("2", { occurredAt: middle }),
      entry("1", { occurredAt: oldest }),
    ]);

    expect(result).toEqual([
      {
        event: "portfolio_read",
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        count: 3,
        first: oldest,
        last: newest,
      },
    ]);
  });

  it("breaks the run when a different event sits in between", () => {
    const t1 = new Date("2026-09-28T14:35:00.000Z");
    const t2 = new Date("2026-09-28T14:20:00.000Z");
    const t3 = new Date("2026-09-28T14:02:00.000Z");

    const result = groupAccessLog([
      entry("3", { event: "portfolio_read", occurredAt: t1 }),
      entry("2", { event: "decisions_read", occurredAt: t2 }),
      entry("1", { event: "portfolio_read", occurredAt: t3 }),
    ]);

    expect(result).toHaveLength(3);
    expect(result.map((group) => group.event)).toEqual([
      "portfolio_read",
      "decisions_read",
      "portfolio_read",
    ]);
    expect(result.every((group) => group.count === 1)).toBe(true);
  });

  it("keeps entries from the same event but a different origin apart", () => {
    const t1 = new Date("2026-09-28T14:35:00.000Z");
    const t2 = new Date("2026-09-28T14:02:00.000Z");

    const result = groupAccessLog([
      entry("2", { occurredAt: t1, ipAddress: "203.0.113.7" }),
      entry("1", { occurredAt: t2, ipAddress: "198.51.100.4" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ ipAddress: "203.0.113.7", count: 1 });
    expect(result[1]).toMatchObject({ ipAddress: "198.51.100.4", count: 1 });
  });

  it("treats null IP or user agent as an ordinary value to compare, not a wildcard", () => {
    const t1 = new Date("2026-09-28T14:35:00.000Z");
    const t2 = new Date("2026-09-28T14:02:00.000Z");

    const merged = groupAccessLog([
      entry("2", { occurredAt: t1, ipAddress: null, userAgent: null }),
      entry("1", { occurredAt: t2, ipAddress: null, userAgent: null }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ ipAddress: null, userAgent: null, count: 2 });

    const apart = groupAccessLog([
      entry("2", { occurredAt: t1, ipAddress: null, userAgent: null }),
      entry("1", { occurredAt: t2, ipAddress: "203.0.113.7", userAgent: null }),
    ]);
    expect(apart).toHaveLength(2);
  });
});
