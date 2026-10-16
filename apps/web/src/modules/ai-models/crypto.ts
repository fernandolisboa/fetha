import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const HKDF_SALT = "fetha:ai-settings:hkdf-salt:v1";
const HKDF_INFO = "fetha:anthropic-api-key:v1";
const FORMAT_VERSION = "v1";

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, KEY_BYTES));
}

// AES-256-GCM with a key derived from `BETTER_AUTH_SECRET` by HKDF-SHA256
// (never the app secret directly) and the user id as AAD, so a ciphertext
// decrypted under the wrong user's id fails closed (docs/adr/0068). A
// rotated `BETTER_AUTH_SECRET` makes every stored key unreadable: a known,
// accepted consequence (see the ADR), not a bug to work around here.
export function encryptApiKey(plaintext: string, secret: string, userId: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export type DecryptResult = { ok: true; plaintext: string } | { ok: false };

export function decryptApiKey(stored: string, secret: string, userId: string): DecryptResult {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    return { ok: false };
  }
  const [, ivPart, tagPart, ciphertextPart] = parts;
  if (ivPart === undefined || tagPart === undefined || ciphertextPart === undefined) {
    return { ok: false };
  }
  try {
    const key = deriveKey(secret);
    const iv = Buffer.from(ivPart, "base64");
    const tag = Buffer.from(tagPart, "base64");
    const ciphertext = Buffer.from(ciphertextPart, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(userId, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
    return { ok: true, plaintext };
  } catch {
    return { ok: false };
  }
}
