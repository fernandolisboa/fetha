import { describe, expect, it } from "vitest";

import { documentPolicy, newNonce } from "./document-policy";

describe("documentPolicy", () => {
  it("allows only nonced scripts and what they load, plus same-origin workers", () => {
    expect(documentPolicy("abc", false)).toBe(
      "script-src 'self' 'nonce-abc' 'strict-dynamic'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
  });

  it("allows eval only in development", () => {
    expect(documentPolicy("abc", true)).toContain("'strict-dynamic' 'unsafe-eval';");
    expect(documentPolicy("abc", false)).not.toContain("unsafe-eval");
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
