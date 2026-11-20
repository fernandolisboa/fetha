import { describe, expect, it } from "vitest";

import { ivRegimeFromLabel } from "./iv-regime";

describe("ivRegimeFromLabel", () => {
  it("maps low and high straight through", () => {
    expect(ivRegimeFromLabel("low")).toBe("low");
    expect(ivRegimeFromLabel("high")).toBe("high");
  });

  it("maps normal and no reading to 'any'", () => {
    expect(ivRegimeFromLabel("normal")).toBe("any");
    expect(ivRegimeFromLabel(null)).toBe("any");
  });
});
