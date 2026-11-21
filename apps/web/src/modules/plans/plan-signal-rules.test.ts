import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  sessionDateSchema,
  type ResolvedExitRule,
  type RollRule,
} from "@fetha/contracts";

import {
  evaluatedPlanSignalKinds,
  firedPlanSignalKinds,
  type PlanSignalInputs,
  type PriceBases,
} from "./plan-signal-rules";

const centavos = (value: number) => centavosSchema.parse(value);
const decimal = (value: string) => decimalStringSchema.parse(value);
const session = (value: string) => sessionDateSchema.parse(value);

const defaultPriceBases: PriceBases = {
  premiumBaseCentavos: centavos(1000),
  maxLossBaseCentavos: centavos(5000),
};

function baseInputs(overrides: Partial<PlanSignalInputs> = {}): PlanSignalInputs {
  return {
    priceBases: defaultPriceBases,
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

  // Review round 2, #381: a short call sold at 1,00 (100 shares, premium received 100,00) with a
  // 2x stop against the entry-priced base — unbounded max loss, so the base falls back to the
  // (absolute) premium, 10 000 centavos. The threshold is exactly −20 000 centavos of unrealized
  // P&L: a mark of 3,00 (a loss of 200,00) reaches it, a mark of 2,99 (a loss of 199,00) does not.
  it("a short call's 2x stop fires at a 200,00 loss and not at 199,00", () => {
    const shortCallInputs = (lossCentavos: number) =>
      baseInputs({
        exitRules: [
          { rule: { kind: "stop_loss", multipleOfMaxLoss: decimal("2") }, session: null },
        ],
        priceBases: { premiumBaseCentavos: centavos(10_000), maxLossBaseCentavos: "unbounded" },
        unrealizedPnlCentavos: centavos(-lossCentavos),
      });
    expect(firedPlanSignalKinds(shortCallInputs(20_000))).toEqual(["stop_hit"]);
    expect(firedPlanSignalKinds(shortCallInputs(19_900))).toEqual([]);
  });

  it("falls back to the premium base as the max-loss base for an unbounded max loss", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({
        exitRules: [stopLossRule],
        priceBases: { premiumBaseCentavos: centavos(1000), maxLossBaseCentavos: "unbounded" },
        unrealizedPnlCentavos: centavos(-500),
      }),
    );
    expect(fired).toEqual(["stop_hit"]);
  });

  it("never fires profit_target with a zero premium base", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({
        exitRules: [profitTargetRule],
        priceBases: { premiumBaseCentavos: centavos(0), maxLossBaseCentavos: centavos(5000) },
        unrealizedPnlCentavos: centavos(1000),
      }),
    );
    expect(fired).toEqual([]);
  });

  it("never fires stop_hit with a zero max-loss base", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({
        exitRules: [stopLossRule],
        priceBases: { premiumBaseCentavos: centavos(1000), maxLossBaseCentavos: centavos(0) },
        unrealizedPnlCentavos: centavos(-100000),
      }),
    );
    expect(fired).toEqual([]);
  });

  // The skip this file's own top comment documents, centralized here rather than trusted to a
  // caller-side filter (review round 2, #381): no resolved price bases at all means neither
  // price-based rule can ever fire, regardless of how large the unrealized loss or profit is.
  it("never fires profit_target or stop_loss with no price bases at all", () => {
    const fired = firedPlanSignalKinds(
      baseInputs({
        exitRules: [profitTargetRule, stopLossRule],
        priceBases: null,
        unrealizedPnlCentavos: centavos(1_000_000),
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

  it("fires expiry_near once today's session reaches a days_before_expiry rule's own session", () => {
    const rule: ResolvedExitRule = {
      rule: { kind: "days_before_expiry", businessDays: 5 },
      session: session("2026-11-20"),
    };
    expect(firedPlanSignalKinds(baseInputs({ exitRules: [rule] }))).toEqual(["expiry_near"]);
    const notYet = firedPlanSignalKinds(
      baseInputs({ exitRules: [rule], todaySession: session("2026-11-19") }),
    );
    expect(notYet).toEqual([]);
  });

  it("still fires expiry_near with no price bases at all", () => {
    const rule: ResolvedExitRule = {
      rule: { kind: "days_before_expiry", businessDays: 5 },
      session: session("2026-11-20"),
    };
    expect(firedPlanSignalKinds(baseInputs({ exitRules: [rule], priceBases: null }))).toEqual([
      "expiry_near",
    ]);
  });

  it("never fires for a condition exit rule (no indicator evaluation in this nightly step)", () => {
    const rule: ResolvedExitRule = {
      rule: {
        kind: "condition",
        condition: {
          kind: "compare",
          left: { kind: "price", field: "close" },
          comparator: "<",
          right: { kind: "constant", value: decimal("30") },
        },
      },
      session: null,
    };
    expect(firedPlanSignalKinds(baseInputs({ exitRules: [rule] }))).toEqual([]);
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

describe("evaluatedPlanSignalKinds", () => {
  it("is every kind with resolved price bases", () => {
    expect([...evaluatedPlanSignalKinds(defaultPriceBases)].sort()).toEqual(
      ["expiry_near", "roll_due", "stop_hit", "target_hit"].sort(),
    );
  });

  it("is every kind but the two price-based ones with no price bases", () => {
    expect([...evaluatedPlanSignalKinds(null)].sort()).toEqual(["expiry_near", "roll_due"].sort());
  });
});
