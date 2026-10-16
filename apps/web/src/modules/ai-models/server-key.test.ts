import { describe, expect, it } from "vitest";

import { readAnthropicApiKey } from "./server-key";

describe("readAnthropicApiKey", () => {
  it("returns undefined when the key is missing", () => {
    expect(readAnthropicApiKey({})).toBeUndefined();
  });

  it("returns undefined when the key is an empty string", () => {
    expect(readAnthropicApiKey({ ANTHROPIC_API_KEY: "" })).toBeUndefined();
  });

  it("returns the key when present", () => {
    expect(readAnthropicApiKey({ ANTHROPIC_API_KEY: "sk-test" })).toBe("sk-test");
  });

  it("trims surrounding whitespace, and treats a whitespace-only value as missing", () => {
    expect(readAnthropicApiKey({ ANTHROPIC_API_KEY: " sk-test " })).toBe("sk-test");
    expect(readAnthropicApiKey({ ANTHROPIC_API_KEY: "   " })).toBeUndefined();
  });
});
