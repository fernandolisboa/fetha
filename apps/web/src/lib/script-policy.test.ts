import { describe, expect, it } from "vitest";

import { newNonce, scriptPolicy } from "./script-policy";

describe("scriptPolicy", () => {
  it("allows only nonced scripts and what they load, plus same-origin workers", () => {
    expect(scriptPolicy("abc", false)).toBe(
      "script-src 'self' 'nonce-abc' 'strict-dynamic'; worker-src 'self'",
    );
  });

  it("allows eval only in development", () => {
    expect(scriptPolicy("abc", true)).toContain("'strict-dynamic' 'unsafe-eval';");
    expect(scriptPolicy("abc", false)).not.toContain("unsafe-eval");
  });
});

describe("newNonce", () => {
  it("draws 128 random bits, base64-encoded, fresh on every call", () => {
    const nonces = new Set(Array.from({ length: 100 }, () => newNonce()));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });
});
