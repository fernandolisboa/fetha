import { instantSchema, type Instant } from "@fetha/contracts";

// `Instant` (docs: packages/contracts/src/scalars.ts) is an ISO datetime
// with millisecond precision and no non-UTC offset (`offset: false` means
// UTC-only, not "no `Z`" — the schema still requires the trailing `Z`),
// which is exactly what `Date#toISOString()` already produces.
export function nowInstant(date: Date = new Date()): Instant {
  return instantSchema.parse(date.toISOString());
}
