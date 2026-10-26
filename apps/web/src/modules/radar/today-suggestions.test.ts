import { describe, expect, it } from "vitest";

import type { SuggestionView } from "./suggestion-view";
import { todaySuggestions } from "./today-suggestions";

function view(underlying: string, tradedSeries: number, recipeId = "bull-call-spread-low-iv") {
  return {
    underlying,
    recipeId,
    reading: { options: { tradedSeries } },
  } as unknown as SuggestionView;
}

describe("todaySuggestions (docs/adr/0073)", () => {
  it("shows the newest close's suggestions ordered by traded series, then ticker and recipe", () => {
    const result = todaySuggestions("2026-10-20", 0, [
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

  it("keeps showing them while the radar is overdue on later closes, and says by how many", () => {
    expect(todaySuggestions("2026-10-20", 3, [view("PETR4", 90)])).toMatchObject({
      kind: "open",
      session: "2026-10-20",
      overdueSessions: 3,
    });
  });

  it("shows nothing when the newest close has no suggestion", () => {
    expect(todaySuggestions("2026-10-20", 0, [])).toEqual({ kind: "none" });
  });
});
