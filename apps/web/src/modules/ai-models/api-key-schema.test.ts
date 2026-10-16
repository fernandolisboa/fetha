import { describe, expect, it } from "vitest";

import { anthropicApiKeySchema } from "./api-key-schema";

describe("anthropicApiKeySchema", () => {
  it("accepts a well-shaped key", () => {
    expect(
      anthropicApiKeySchema.safeParse("sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaa").success,
    ).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const result = anthropicApiKeySchema.safeParse("  sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaa  ");
    expect(result).toMatchObject({
      success: true,
      data: "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("rejects a key with no sk-ant- prefix", () => {
    expect(anthropicApiKeySchema.safeParse("api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaa").success).toBe(
      false,
    );
  });

  it("rejects a key shorter than the minimum", () => {
    expect(anthropicApiKeySchema.safeParse("sk-ant-short").success).toBe(false);
  });

  it("rejects a key over 300 characters", () => {
    expect(anthropicApiKeySchema.safeParse(`sk-ant-${"a".repeat(300)}`).success).toBe(false);
  });

  it("rejects characters outside the allowed alphabet", () => {
    expect(anthropicApiKeySchema.safeParse("sk-ant-aaaaaaaaaaaaaaaaaaaa!!!!").success).toBe(false);
  });
});
