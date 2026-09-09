import { describe, expect, it } from "vitest";
import { registrationModeSchema } from "./registration-mode";

describe("registrationModeSchema", () => {
  it("accepts the three operational modes", () => {
    expect(registrationModeSchema.parse("open")).toBe("open");
    expect(registrationModeSchema.parse("invite")).toBe("invite");
    expect(registrationModeSchema.parse("closed")).toBe("closed");
  });

  it("defaults to invite when the variable is unset", () => {
    expect(registrationModeSchema.parse(undefined)).toBe("invite");
  });

  it("defaults to invite when the variable is an empty string", () => {
    expect(registrationModeSchema.parse("")).toBe("invite");
  });

  it("rejects unknown values", () => {
    expect(registrationModeSchema.safeParse("public").success).toBe(false);
  });
});
