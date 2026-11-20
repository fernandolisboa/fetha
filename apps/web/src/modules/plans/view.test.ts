import { describe, expect, it } from "vitest";

import { expectedMoveForView, planViews } from "./view";

describe("expectedMoveForView", () => {
  it("maps a stated view onto the recipe book's own expected move", () => {
    expect(expectedMoveForView("up")).toBe("up");
    expect(expectedMoveForView("down")).toBe("down");
    expect(expectedMoveForView("sideways")).toBe("sideways");
  });

  it("carries no direction for 'não sei'", () => {
    expect(expectedMoveForView("unsure")).toBeNull();
  });

  it("covers exactly the four answers the asset page asks", () => {
    expect(planViews).toEqual(["up", "down", "sideways", "unsure"]);
  });
});
