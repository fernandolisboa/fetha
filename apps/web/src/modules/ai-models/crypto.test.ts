import { describe, expect, it } from "vitest";

import { decryptApiKey, encryptApiKey } from "./crypto";

const SECRET = "local-test-secret-0123456789-abcdefghijklmnop";
const OTHER_SECRET = "a-different-secret-9876543210-zyxwvutsrqponml";
const USER_A = "user-a";
const USER_B = "user-b";
const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

describe("encryptApiKey / decryptApiKey", () => {
  it("round-trips the plaintext under the same secret and user id", () => {
    const stored = encryptApiKey(KEY, SECRET, USER_A);
    expect(decryptApiKey(stored, SECRET, USER_A)).toEqual({ ok: true, plaintext: KEY });
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptApiKey(KEY, SECRET, USER_A)).not.toBe(encryptApiKey(KEY, SECRET, USER_A));
  });

  it("fails closed under the wrong AAD (a different user id)", () => {
    const stored = encryptApiKey(KEY, SECRET, USER_A);
    expect(decryptApiKey(stored, SECRET, USER_B)).toEqual({ ok: false });
  });

  it("fails closed under the wrong secret", () => {
    const stored = encryptApiKey(KEY, SECRET, USER_A);
    expect(decryptApiKey(stored, OTHER_SECRET, USER_A)).toEqual({ ok: false });
  });

  it("fails closed on a tampered tag", () => {
    const stored = encryptApiKey(KEY, SECRET, USER_A);
    const [version, iv, , ciphertext] = stored.split(":");
    const tampered = [
      version,
      iv,
      Buffer.from("tampered-tag-value").toString("base64"),
      ciphertext,
    ].join(":");
    expect(decryptApiKey(tampered, SECRET, USER_A)).toEqual({ ok: false });
  });

  it("fails closed on a malformed stored value", () => {
    expect(decryptApiKey("not-a-valid-value", SECRET, USER_A)).toEqual({ ok: false });
    expect(decryptApiKey("v2:a:b:c", SECRET, USER_A)).toEqual({ ok: false });
  });
});
