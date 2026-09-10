import { describe, expect, it } from "vitest";
import { nowInstant } from "./instant";

describe("nowInstant", () => {
  it("formats as a millisecond-precision UTC ISO datetime", () => {
    const result = nowInstant(new Date("2026-09-10T13:05:07.123Z"));
    expect(result).toBe("2026-09-10T13:05:07.123Z");
  });
});
