import { describe, expect, it } from "vitest";

import { movesForView, planViews } from "./view";

describe("movesForView", () => {
  it("maps a stated direction onto the recipe book's own expected move", () => {
    expect(movesForView("up")).toEqual(["up"]);
    expect(movesForView("down")).toEqual(["down"]);
    expect(movesForView("sideways")).toEqual(["sideways"]);
  });

  it("admits sideways and big_move recipes for 'não sei'", () => {
    expect(movesForView("unsure")).toEqual(["sideways", "big_move"]);
  });

  it("covers exactly the four answers the asset page asks", () => {
    expect(planViews).toEqual(["up", "down", "sideways", "unsure"]);
  });
});
