import { sessionDateSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { suggestionValidity } from "./suggestion-validity";

const day = (value: string) => sessionDateSchema.parse(value);

describe("suggestionValidity (docs/adr/0073)", () => {
  it("is current while its close is the newest the radar has read", () => {
    expect(suggestionValidity(day("2026-10-20"), day("2026-10-20"))).toEqual({ archived: false });
  });

  it("is archived once the radar reads a newer close, however many days later", () => {
    expect(suggestionValidity(day("2026-10-20"), day("2026-10-21"))).toEqual({
      archived: true,
      supersededBy: "2026-10-21",
    });
    expect(suggestionValidity(day("2026-10-20"), day("2026-10-26"))).toEqual({
      archived: true,
      supersededBy: "2026-10-26",
    });
  });

  it("is never archived by an older reading or by none at all", () => {
    expect(suggestionValidity(day("2026-10-20"), day("2026-10-16"))).toEqual({ archived: false });
    expect(suggestionValidity(day("2026-10-20"), null)).toEqual({ archived: false });
  });
});
