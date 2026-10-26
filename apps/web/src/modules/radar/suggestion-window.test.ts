import { sessionDateSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { suggestionWindow } from "./suggestion-window";

const day = (value: string) => sessionDateSchema.parse(value);

describe("suggestionWindow (docs/adr/0072)", () => {
  it("is open on the evening of its own close and through the next session's day", () => {
    expect(suggestionWindow(day("2026-10-20"), day("2026-10-21"), day("2026-10-20"))).toEqual({
      openThrough: "2026-10-21",
      archived: false,
    });
    expect(suggestionWindow(day("2026-10-20"), day("2026-10-21"), day("2026-10-21"))).toEqual({
      openThrough: "2026-10-21",
      archived: false,
    });
  });

  it("is archived from the day after the next session", () => {
    expect(suggestionWindow(day("2026-10-20"), day("2026-10-21"), day("2026-10-22")).archived).toBe(
      true,
    );
    expect(suggestionWindow(day("2026-10-20"), day("2026-10-21"), day("2026-10-26")).archived).toBe(
      true,
    );
  });

  it("stays open over a weekend or holiday until the next session's day ends", () => {
    const friday = day("2026-10-23");
    const monday = day("2026-10-26");
    expect(suggestionWindow(friday, monday, day("2026-10-24")).archived).toBe(false);
    expect(suggestionWindow(friday, monday, day("2026-10-25")).archived).toBe(false);
    expect(suggestionWindow(friday, monday, monday).archived).toBe(false);
    expect(suggestionWindow(friday, monday, day("2026-10-27")).archived).toBe(true);
  });

  it("closes on its own session's day when the calendar does not reach the next session", () => {
    expect(suggestionWindow(day("2027-12-30"), undefined, day("2027-12-30"))).toEqual({
      openThrough: "2027-12-30",
      archived: false,
    });
    expect(suggestionWindow(day("2027-12-30"), undefined, day("2027-12-31")).archived).toBe(true);
  });
});
