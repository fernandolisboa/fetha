import { describe, expect, it } from "vitest";

import { formatQuantity } from "./quantity";

describe("formatQuantity", () => {
  it("adds the pt-BR thousands separator", () => {
    expect(formatQuantity(1100)).toBe("1.100");
  });

  it("leaves a number under a thousand unchanged", () => {
    expect(formatQuantity(300)).toBe("300");
  });

  it("separates millions with another dot", () => {
    expect(formatQuantity(1_234_567)).toBe("1.234.567");
  });

  it("formats zero plainly", () => {
    expect(formatQuantity(0)).toBe("0");
  });
});
