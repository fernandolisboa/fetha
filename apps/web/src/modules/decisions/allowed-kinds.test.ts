import { describe, expect, it } from "vitest";

import { allowedDecisionKinds } from "./allowed-kinds";

describe("allowedDecisionKinds", () => {
  it("allows enter / do_not_enter for an entry signal", () => {
    expect(allowedDecisionKinds({ kind: "signal", signalKind: "entry" })).toEqual([
      "enter",
      "do_not_enter",
    ]);
  });

  it("allows exit / hold for an exit signal", () => {
    expect(allowedDecisionKinds({ kind: "signal", signalKind: "exit" })).toEqual(["exit", "hold"]);
  });

  it("allows adjust / hold for an adjust signal", () => {
    expect(allowedDecisionKinds({ kind: "signal", signalKind: "adjust" })).toEqual([
      "adjust",
      "hold",
    ]);
  });

  it("allows enter / do_not_enter for a contemplated operation", () => {
    expect(allowedDecisionKinds({ kind: "contemplated_operation" })).toEqual([
      "enter",
      "do_not_enter",
    ]);
  });
});
