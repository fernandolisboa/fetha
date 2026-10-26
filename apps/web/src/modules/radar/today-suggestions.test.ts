import { describe, expect, it } from "vitest";

import type { SuggestionView } from "./suggestion-view";
import { todaySuggestions } from "./today-suggestions";

const open = { openThrough: "2026-10-21", archived: false };
const archived = { openThrough: "2026-10-21", archived: true };

function view(underlying: string, tradedSeries: number, recipeId = "bull-call-spread-low-iv") {
  return {
    underlying,
    recipeId,
    reading: { options: { tradedSeries } },
  } as unknown as SuggestionView;
}

describe("todaySuggestions (docs/adr/0072)", () => {
  it("shows the open ones ordered by traded series, then ticker and recipe", () => {
    const result = todaySuggestions("2026-10-20", open, [
      view("VALE3", 40),
      view("PETR4", 90, "long-call-low-iv"),
      view("PETR4", 90),
      view("BBAS3", 40),
    ]);
    expect(result.kind).toBe("open");
    expect(
      result.kind === "open" ? result.suggestions.map((s) => `${s.underlying}/${s.recipeId}`) : [],
    ).toEqual([
      "PETR4/bull-call-spread-low-iv",
      "PETR4/long-call-low-iv",
      "BBAS3/bull-call-spread-low-iv",
      "VALE3/bull-call-spread-low-iv",
    ]);
  });

  it("says when the newest ones were archived instead of showing them", () => {
    expect(todaySuggestions("2026-10-20", archived, [view("PETR4", 90)])).toEqual({
      kind: "archived",
      session: "2026-10-20",
      openThrough: "2026-10-21",
    });
  });

  it("shows nothing when the newest session has no suggestion left to show", () => {
    expect(todaySuggestions("2026-10-20", open, [])).toEqual({ kind: "none" });
    expect(todaySuggestions("2026-10-20", archived, [])).toEqual({ kind: "none" });
  });
});
