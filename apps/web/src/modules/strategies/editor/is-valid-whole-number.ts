// Pure predicate NumberField uses to decide whether a raw string it holds
// while the user is typing is a committable whole number: extracted so the
// "cleared field stays uncommitted, not coerced to 0" rule has a test that
// does not need to render a component.
export function isValidWholeNumber(raw: string, min?: number): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return false;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && (min === undefined || parsed >= min);
}
