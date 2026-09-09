import type { Instant } from "@fetha/contracts";

export function instantMs(instant: Instant): number {
  return new Date(instant).getTime();
}

export function compareInstants(a: Instant, b: Instant): number {
  return instantMs(a) - instantMs(b);
}

export function isAfter(a: Instant, b: Instant): boolean {
  return compareInstants(a, b) > 0;
}

export function isAtOrBefore(a: Instant, b: Instant): boolean {
  return compareInstants(a, b) <= 0;
}
