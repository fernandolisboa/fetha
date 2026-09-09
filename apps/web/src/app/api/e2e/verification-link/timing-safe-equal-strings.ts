import { timingSafeEqual } from "node:crypto";

export function timingSafeEqualStrings(provided: string, configured: string): boolean {
  const providedBytes = Buffer.from(provided);
  const configuredBytes = Buffer.from(configured);
  if (providedBytes.byteLength !== configuredBytes.byteLength) {
    return false;
  }
  return timingSafeEqual(providedBytes, configuredBytes);
}
