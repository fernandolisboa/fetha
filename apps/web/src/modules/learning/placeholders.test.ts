import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { centavosSchema, decimalStringSchema } from "@fetha/contracts";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";
import { formatQuantity } from "@/lib/format/quantity";
import { DEFAULT_RISK_PROFILE } from "@/modules/portfolio/client";

import { loadIllustrativeExamples } from "./illustrative-market";
import { placeholderTokens, resolvePlaceholder, resolveText } from "./placeholders";

describe("placeholderTokens", () => {
  it("extracts every {{token}} in order", () => {
    expect(placeholderTokens("spot {{spot}}, strike {{lowerStrike}}.")).toEqual([
      "spot",
      "lowerStrike",
    ]);
  });

  it("returns an empty list when there is no placeholder", () => {
    expect(placeholderTokens("plain text")).toEqual([]);
  });
});

describe("resolvePlaceholder", () => {
  it("resolves spot and strike tokens to a formatted price", async () => {
    const examples = await loadIllustrativeExamples();
    expect(resolvePlaceholder("spot", examples)).toBe("R$ 20,00");
    expect(resolvePlaceholder("lowestStrike", examples)).toBe("R$ 18,00");
    expect(resolvePlaceholder("lowerStrike", examples)).toBe("R$ 20,00");
    expect(resolvePlaceholder("lowerMidStrike", examples)).toBe("R$ 19,00");
    expect(resolvePlaceholder("upperMidStrike", examples)).toBe("R$ 21,00");
    expect(resolvePlaceholder("higherStrike", examples)).toBe("R$ 22,00");
  });

  it("resolves a second break-even on a structure that has two", async () => {
    const examples = await loadIllustrativeExamples();
    const straddle = examples["long-straddle"];
    const [first, second] = straddle.breakEvens;
    if (!first || !second) throw new Error("fixture straddle lacks two break-evens");
    expect(resolvePlaceholder("long-straddle.breakEven0", examples)).toBe(formatPriceBRL(first));
    expect(resolvePlaceholder("long-straddle.breakEven1", examples)).toBe(formatPriceBRL(second));
  });

  it("resolves theta's magnitude regardless of its sign, never to R$0,00", async () => {
    const examples = await loadIllustrativeExamples();
    const resolved = resolvePlaceholder("long-call.thetaAbs", examples);
    expect(resolved).toMatch(/^R\$ \d/);
    expect(resolved).not.toBe("R$ 0,00");
    expect(Math.abs(Number(examples["long-call"].greeks.theta))).toBeGreaterThan(0);
  });

  it("resolves delta and gamma to the engine's own signed ratio, four decimals", async () => {
    const examples = await loadIllustrativeExamples();
    const longCall = examples["long-call"];
    const longPut = examples["long-put"];
    expect(resolvePlaceholder("long-call.delta", examples)).toBe(
      formatDecimal(longCall.greeks.delta, 4),
    );
    expect(resolvePlaceholder("long-put.delta", examples)).toBe(
      formatDecimal(longPut.greeks.delta, 4),
    );
    expect(resolvePlaceholder("long-call.gamma", examples)).toBe(
      formatDecimal(longCall.greeks.gamma, 4),
    );
    expect(Number(longCall.greeks.delta)).toBeGreaterThan(0);
    expect(Number(longPut.greeks.delta)).toBeLessThan(0);
  });

  function perLotFromShare(perShare: string): string {
    return new Decimal(perShare).mul(100).toFixed(6);
  }

  // Same rounding as the suggestion card's own `sharesText`
  // (radar/components/greek-notes.tsx): round to a whole share unless that would erase a
  // nonzero value, in which case one decimal survives instead.
  function sharesEquivalent(perShare: string): string {
    const abs = new Decimal(perShare).mul(100).abs();
    const whole = abs.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    if (whole.isZero() && !abs.isZero()) {
      return formatDecimal(
        decimalStringSchema.parse(abs.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString()),
        1,
      );
    }
    return formatDecimal(decimalStringSchema.parse(whole.toString()), 0);
  }

  it("resolves delta and gamma as the suggestion card's own shares-equivalent reading", async () => {
    const examples = await loadIllustrativeExamples();
    const longCall = examples["long-call"];
    expect(resolvePlaceholder("long-call.deltaShares", examples)).toBe(
      sharesEquivalent(longCall.greeks.delta),
    );
    expect(resolvePlaceholder("long-call.deltaShares", examples)).toBe("54");
    expect(resolvePlaceholder("long-call.gammaShares", examples)).toBe(
      sharesEquivalent(longCall.greeks.gamma),
    );
    expect(resolvePlaceholder("long-call.gammaShares", examples)).toBe("10");
  });

  it("resolves vega as money per lot, scaled from the engine's per-share value before rounding", async () => {
    const examples = await loadIllustrativeExamples();
    const longCall = examples["long-call"];
    const shortCall = examples["short-call"];
    const ironCondor = examples["iron-condor"];
    expect(resolvePlaceholder("long-call.vega", examples)).toBe(
      formatPriceBRL(decimalStringSchema.parse(perLotFromShare(longCall.greeks.vega))),
    );
    expect(resolvePlaceholder("long-call.vega", examples)).toBe("R$ 3,00");
    expect(resolvePlaceholder("short-call.vega", examples)).toBe(
      formatPriceBRL(decimalStringSchema.parse(perLotFromShare(shortCall.greeks.vega))),
    );
    expect(resolvePlaceholder("short-call.vega", examples)).toBe("−R$ 3,00");
    // The whole point of scaling before rounding: a per-share vega rounded to the centavo first,
    // then multiplied by 100, would compound that rounding error far past a single cent (B1,
    // review round 2) — this pins the iron condor's own case, where that error would show.
    expect(resolvePlaceholder("iron-condor.vega", examples)).toBe(
      formatPriceBRL(decimalStringSchema.parse(perLotFromShare(ironCondor.greeks.vega))),
    );
    expect(resolvePlaceholder("iron-condor.vega", examples)).toBe("−R$ 0,58");
  });

  it("resolves the default risk profile's own declared capital, limit and computed cap", async () => {
    const examples = await loadIllustrativeExamples();
    expect(resolvePlaceholder("defaultDeclaredCapitalAbs", examples)).toBe(
      formatBRL(DEFAULT_RISK_PROFILE.declaredCapital),
    );
    expect(resolvePlaceholder("defaultMaxLossPerOperationPercent", examples)).toBe(
      formatPercent(DEFAULT_RISK_PROFILE.limits.maxLossPerOperation),
    );
    expect(resolvePlaceholder("defaultMaxLossCapAbs", examples)).toBe("R$ 1.000,00");
  });

  it("resolves an example's own per-lot max loss and the lot count that cap allows", async () => {
    const examples = await loadIllustrativeExamples();
    const { maxLoss } = examples["iron-condor"];
    if (maxLoss === "unbounded") throw new Error("fixture iron condor lacks a bounded max loss");
    expect(resolvePlaceholder("iron-condor.maxLossPerLotAbs", examples)).toBe(
      formatBRL(centavosSchema.parse(Math.abs(maxLoss) * 100)),
    );
    expect(resolvePlaceholder("iron-condor.maxLossLotsAtDefaultCap", examples)).toBe(
      formatQuantity(31),
    );
  });

  it("throws when a per-lot max loss is zero or the lot count would be below one", async () => {
    const examples = await loadIllustrativeExamples();
    const { maxLoss } = examples["long-call"];
    if (maxLoss === "unbounded") throw new Error("fixture long call lacks a bounded max loss");
    const zeroLossExamples = {
      ...examples,
      "long-call": { ...examples["long-call"], maxLoss: centavosSchema.parse(0) },
    };
    expect(() => resolvePlaceholder("long-call.maxLossPerLotAbs", zeroLossExamples)).toThrow();
    const hugeLossExamples = {
      ...examples,
      "long-call": {
        ...examples["long-call"],
        maxLoss: centavosSchema.parse(maxLoss * 1_000_000),
      },
    };
    expect(() =>
      resolvePlaceholder("long-call.maxLossLotsAtDefaultCap", hugeLossExamples),
    ).toThrow();
  });

  it("throws resolving maxLossPerLotAbs or the lot count on an unbounded example", async () => {
    const examples = await loadIllustrativeExamples();
    expect(() => resolvePlaceholder("long-call.maxLossPerLotAbs", examples)).not.toThrow();
    expect(() => resolvePlaceholder("short-call.maxLossPerLotAbs", examples)).toThrow();
    expect(() => resolvePlaceholder("short-call.maxLossLotsAtDefaultCap", examples)).toThrow();
  });

  it("throws resolving a break-even index the example does not have", async () => {
    const examples = await loadIllustrativeExamples();
    expect(() => resolvePlaceholder("long-call.breakEven1", examples)).toThrow();
  });

  it("resolves an example's premium and max loss to a positive amount", async () => {
    const examples = await loadIllustrativeExamples();
    expect(resolvePlaceholder("long-call.premiumAbs", examples)).toBe("R$ 1,51");
    expect(resolvePlaceholder("long-call.maxLossAbs", examples)).toBe("R$ 1,51");
  });

  it("throws resolving an unbounded field instead of printing a wrong number", async () => {
    const examples = await loadIllustrativeExamples();
    expect(() => resolvePlaceholder("long-call.maxGainAbs", examples)).toThrow();
    expect(() => resolvePlaceholder("short-call.maxLossAbs", examples)).toThrow();
  });

  it("throws on an unknown token", async () => {
    const examples = await loadIllustrativeExamples();
    expect(() => resolvePlaceholder("not-a-real-token", examples)).toThrow();
  });

  it("resolves a single-leg example's ticker and its decoded series letter", async () => {
    const examples = await loadIllustrativeExamples();
    expect(resolvePlaceholder("long-call.ticker", examples)).toBe("EXMPB105");
    expect(resolvePlaceholder("long-call.tickerLetter", examples)).toBe("B");
    expect(resolvePlaceholder("long-put.ticker", examples)).toBe("EXMPN105");
    expect(resolvePlaceholder("long-put.tickerLetter", examples)).toBe("N");
  });

  it("throws resolving a ticker on a multi-leg example, which names no single series", async () => {
    const examples = await loadIllustrativeExamples();
    expect(() => resolvePlaceholder("bull-call-spread.ticker", examples)).toThrow();
    expect(() => resolvePlaceholder("bull-call-spread.tickerLetter", examples)).toThrow();
  });
});

describe("resolveText", () => {
  it("replaces every placeholder in a sentence", async () => {
    const examples = await loadIllustrativeExamples();
    const text = resolveText("Spot {{spot}}, premium {{long-call.premiumAbs}}.", examples);
    expect(text).toBe("Spot R$ 20,00, premium R$ 1,51.");
  });
});
