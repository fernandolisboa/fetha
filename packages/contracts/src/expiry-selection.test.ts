import { describe, expect, it } from "vitest";
import { expirySelectionKinds, expirySelectionSchema } from "./expiry-selection";

describe("expirySelectionSchema", () => {
  it("lists business_days as the only kind", () => {
    expect(expirySelectionKinds).toEqual(["business_days"]);
  });

  it("accepts a business-day window", () => {
    expect(expirySelectionSchema.parse({ kind: "business_days", min: 20, max: 45 })).toEqual({
      kind: "business_days",
      min: 20,
      max: 45,
    });
  });

  it("accepts a window with min equal to max", () => {
    expect(
      expirySelectionSchema.safeParse({ kind: "business_days", min: 30, max: 30 }).success,
    ).toBe(true);
  });

  it("rejects max below min", () => {
    expect(
      expirySelectionSchema.safeParse({ kind: "business_days", min: 45, max: 20 }).success,
    ).toBe(false);
  });

  it("rejects negative or fractional days and unknown kinds", () => {
    expect(
      expirySelectionSchema.safeParse({ kind: "business_days", min: -1, max: 20 }).success,
    ).toBe(false);
    expect(
      expirySelectionSchema.safeParse({ kind: "business_days", min: 1.5, max: 20 }).success,
    ).toBe(false);
    expect(
      expirySelectionSchema.safeParse({ kind: "calendar_days", min: 1, max: 20 }).success,
    ).toBe(false);
  });
});
