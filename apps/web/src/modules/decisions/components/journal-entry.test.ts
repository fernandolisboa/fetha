import { describe, expect, it } from "vitest";

import { unscorableReasonLabel } from "./journal-entry";

describe("unscorableReasonLabel", () => {
  it("translates a known reason code", () => {
    expect(unscorableReasonLabel("insufficient_data")).toBe("os dados de mercado nunca chegaram");
  });

  it("falls back to a generic pt-BR string for an unknown reason, never the raw code (round 3 item 10)", () => {
    expect(unscorableReasonLabel("scoring_failed")).toBe("não foi possível pontuar");
    expect(unscorableReasonLabel("engine_error:some_future_code")).toBe("não foi possível pontuar");
  });
});
