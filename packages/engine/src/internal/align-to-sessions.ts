import type { SessionDate } from "@fetha/contracts";
import { assertDefined } from "./invariant";

export function alignToSessions<T>(
  targetSessions: readonly SessionDate[],
  sourceSessions: readonly SessionDate[],
  values: readonly T[],
): (T | null)[] {
  let pointer = -1;
  return targetSessions.map((session) => {
    while (
      pointer + 1 < sourceSessions.length &&
      assertDefined(sourceSessions[pointer + 1], "alignToSessions: missing source session") <=
        session
    ) {
      pointer += 1;
    }
    return pointer >= 0 ? assertDefined(values[pointer], "alignToSessions: missing value") : null;
  });
}
