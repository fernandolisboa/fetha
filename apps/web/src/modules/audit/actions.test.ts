import { describe, expect, it } from "vitest";

import { listAccessLogInputSchema } from "./actions";

describe("listAccessLogInputSchema", () => {
  it("accepts an empty input", () => {
    expect(listAccessLogInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a well-formed set of filters and a cursor", () => {
    const result = listAccessLogInputSchema.safeParse({
      from: "2026-01-01",
      to: "2026-01-31",
      event: "portfolio_read",
      ipAddress: "203.0.113.7",
      cursor: {
        occurredAt: "2026-01-15T12:00:00.000Z",
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects from after to", () => {
    const result = listAccessLogInputSchema.safeParse({ from: "2026-02-01", to: "2026-01-01" });
    expect(result.success).toBe(false);
  });

  it("accepts from equal to to", () => {
    const result = listAccessLogInputSchema.safeParse({ from: "2026-01-01", to: "2026-01-01" });
    expect(result.success).toBe(true);
  });

  it("rejects a cursor with a malformed id", () => {
    const result = listAccessLogInputSchema.safeParse({
      cursor: { occurredAt: "2026-01-15T12:00:00.000Z", id: "not-a-uuid" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a cursor with a non-instant occurredAt", () => {
    const result = listAccessLogInputSchema.safeParse({
      cursor: { occurredAt: "2026-01-15", id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key", () => {
    const result = listAccessLogInputSchema.safeParse({ unknown: "value" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key on the cursor", () => {
    const result = listAccessLogInputSchema.safeParse({
      cursor: {
        occurredAt: "2026-01-15T12:00:00.000Z",
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        extra: "value",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an event outside the vocabulary", () => {
    const result = listAccessLogInputSchema.safeParse({ event: "made_up" });
    expect(result.success).toBe(false);
  });

  it("rejects an ipAddress longer than 64 characters", () => {
    const result = listAccessLogInputSchema.safeParse({ ipAddress: "a".repeat(65) });
    expect(result.success).toBe(false);
  });
});
