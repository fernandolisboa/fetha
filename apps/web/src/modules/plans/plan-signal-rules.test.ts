import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  sessionDateSchema,
  type ResolvedExitRule,
  type RollRule,
} from "@fetha/contracts";

import { firedPlanSignalKinds, type PlanSignalInputs } from "./plan-signal-rules";

const centavos = (value: number) => centavosSchema.parse(value);
const decimal = (value: string) => decimalStringSchema.parse(value);
const session = (value: string) => sessionDateSchema.parse(value);

function baseInputs(overrides: Partial<PlanSignalInputs> = {}): PlanSignalInputs {
  return {
    netPremiumCentavos: centavos(1000),
    maxLossCentavos: centavos(5000),
    unrealizedPnlCentavos: centavos(0),
    exitRules: [],
    roll: { applies: false, session: null },
    todaySession: session("2026-11-20"),
    ...overrides,
  };
}

const profitTargetRule: ResolvedExitRule = {
  rule: { kind: "profit_target", fractionOfPremium: decimal("0.5") },
  session: null,
};
const stopLossRule: ResolvedExitRule = {
  rule: { kind: "stop_loss", multipleOfMaxLoss: decimal("0.5") },
  session: null,
};

describe("firedPlanSignalKinds", () => {
  it("fires target_hit once the captured profit reaches the premium fraction", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({ exitRules: [profitTargetRule], unrealizedPnlCentavos: centavos(500) }),
    );
    expect(fired).toEqual(["target_hit"]);
  });

  it("does not fire target_hit when the profit falls short of the fraction", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({ exitRules: [profitTargetRule], unrealizedPnlCentavos: centavos(499) }),
    );
    expect(fired).toEqual([]);
  });

  it("fires stop_hit once the loss reaches the max-loss multiple", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({ exitRules: [stopLossRule], unrealizedPnlCentavos: centavos(-2500) }),
    );
    expect(fired).toEqual(["stop_hit"]);
  });

  it("does not fire stop_hit when the loss has not reached the multiple yet", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({ exitRules: [stopLossRule], unrealizedPnlCentavos: centavos(-2000) }),
    );
    expect(fired).toEqual([]);
  });

  it("falls back to the premium base as the max-loss base for an unbounded max loss", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({
        exitRules: [stopLossRule],
        maxLossCentavos: "unbounded",
        netPremiumCentavos: centavos(1000),
        unrealizedPnlCentavos: centavos(-500),
      }),
    );
    expect(fired).toEqual(["stop_hit"]);
  });

  it("never fires profit_target with a zero premium base", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({
        exitRules: [profitTargetRule],
        netPremiumCentavos: centavos(0),
        unrealizedPnlCentavos: centavos(1000),
      }),
    );
    expect(fired).toEqual([]);
  });

  it("never fires stop_hit with a zero max-loss base", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({
        exitRules: [stopLossRule],
        maxLossCentavos: centavos(0),
        unrealizedPnlCentavos: centavos(-100000),
      }),
    );
    expect(fired).toEqual([]);
  });

  it("fires roll_due once today's session reaches the roll rule's own session", () => {
    const roll: RollRule = { applies: true, session: session("2026-11-20") };
    expect(firedPlanSignalKinds(baseInputs({ roll })).includes("roll_due")).toBe(true);
    const notYet = firedPlanSignalKinds(baseInputs({ roll, todaySession: session("2026-11-19") }));
    expect(notYet).toEqual([]);
  });

  it("never fires roll_due when the roll rule does not apply", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({ roll: { applies: false, session: session("2026-11-01") } }),
    );
    expect(fired).toEqual([]);
  });

  it("can fire more than one kind at once", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({
        exitRules: [stopLossRule],
        unrealizedPnlCentavos: centavos(-2500),
        roll: { applies: true, session: session("2026-11-20") },
      }),
    );
    expect(fired.sort()).toEqual(["roll_due", "stop_hit"]);
  });
});
