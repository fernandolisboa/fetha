import type { Instant } from "@fetha/contracts";
import { assertDefined } from "./invariant";
import { isAtOrBefore } from "./instant";

export function alignByInstant<T>(
  targets: readonly Instant[],
  sources: readonly Instant[],
  values: readonly T[],
): (T | null)[] {
  let pointer = -1;
  return targets.map((target) => {
    while (
      pointer + 1 < sources.length &&
      isAtOrBefore(assertDefined(sources[pointer + 1], "alignByInstant: missing source"), target)
    ) {
      pointer += 1;
    }
    return pointer >= 0 ? assertDefined(values[pointer], "alignByInstant: missing value") : null;
  });
}
