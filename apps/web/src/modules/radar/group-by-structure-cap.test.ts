import { describe, expect, it } from "vitest";

import { groupSuggestionsByStructureCap, pickVariedSuggestions } from "./group-by-structure-cap";
import type { SuggestionView } from "./suggestion-view";

function view(id: string, structureId: string, structureName = structureId): SuggestionView {
  return { id, structure: { id: structureId, name: structureName } } as unknown as SuggestionView;
}

describe("groupSuggestionsByStructureCap (#378)", () => {
  it("keeps every suggestion at the top when no structure exceeds the cap", () => {
    const suggestions = [
      view("1", "bull-call-spread"),
      view("2", "long-call"),
      view("3", "bull-put-spread"),
    ];

    expect(groupSuggestionsByStructureCap(suggestions, 2)).toEqual({
      top: suggestions,
      overflow: [],
    });
  });

  it("moves a structure's suggestions past the cap into its own overflow group, in order", () => {
    const suggestions = [
      view("1", "call-butterfly", "Borboleta com calls"),
      view("2", "call-butterfly", "Borboleta com calls"),
      view("3", "call-butterfly", "Borboleta com calls"),
      view("4", "long-call"),
      view("5", "call-butterfly", "Borboleta com calls"),
    ];

    expect(groupSuggestionsByStructureCap(suggestions, 2)).toEqual({
      top: [suggestions[0], suggestions[1], suggestions[3]],
      overflow: [
        {
          structureId: "call-butterfly",
          structureName: "Borboleta com calls",
          suggestions: [suggestions[2], suggestions[4]],
        },
      ],
    });
  });

  it("groups more than one overflowing structure, ordered by first overflow", () => {
    const suggestions = [
      view("1", "call-butterfly"),
      view("2", "put-butterfly"),
      view("3", "call-butterfly"),
      view("4", "put-butterfly"),
      view("5", "call-butterfly"),
      view("6", "put-butterfly"),
    ];

    const result = groupSuggestionsByStructureCap(suggestions, 2);

    expect(result.top).toEqual([suggestions[0], suggestions[1], suggestions[2], suggestions[3]]);
    expect(result.overflow.map((group) => group.structureId)).toEqual([
      "call-butterfly",
      "put-butterfly",
    ]);
    expect(result.overflow[0]?.suggestions).toEqual([suggestions[4]]);
    expect(result.overflow[1]?.suggestions).toEqual([suggestions[5]]);
  });

  it("defaults to a cap of 2", () => {
    const suggestions = [view("1", "x"), view("2", "x"), view("3", "x")];

    expect(groupSuggestionsByStructureCap(suggestions).overflow).toEqual([
      { structureId: "x", structureName: "x", suggestions: [suggestions[2]] },
    ]);
  });

  it("returns nothing in the top for an empty list", () => {
    expect(groupSuggestionsByStructureCap([], 2)).toEqual({ top: [], overflow: [] });
  });
});

describe("pickVariedSuggestions (#378)", () => {
  it("picks from the capped, grouped order instead of the raw one, so one structure cannot fill the limit", () => {
    const suggestions = [
      view("1", "call-butterfly"),
      view("2", "call-butterfly"),
      view("3", "call-butterfly"),
      view("4", "bull-call-spread"),
    ];

    expect(pickVariedSuggestions(suggestions, 3)).toEqual([
      suggestions[0],
      suggestions[1],
      suggestions[3],
    ]);
  });

  it("returns fewer than the limit when there are not enough varied suggestions", () => {
    const suggestions = [view("1", "call-butterfly"), view("2", "call-butterfly")];

    expect(pickVariedSuggestions(suggestions, 5)).toEqual(suggestions);
  });
});
