import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  type Centavos,
  type DecimalString,
} from "@fetha/contracts";
import type { PayoffPoint } from "@fetha/engine";

import { gainToRiskRatio, payoffSummarySentence, summarizePayoff } from "./payoff-summary";

function dec(value: string): DecimalString {
  return decimalStringSchema.parse(value);
}

function cents(value: number): Centavos {
  return centavosSchema.parse(value);
}

function point(underlying: string, pnl: number): PayoffPoint {
  return { underlying: dec(underlying), pnl: cents(pnl) };
}

const TICKER = "DIRR3";
const DATE = "18/12/2026";

describe("summarizePayoff", () => {
  it("classifies a debit butterfly as a profit range between its two break-evens", () => {
    const payoff = [point("8.00", -1100), point("9.28", 3900), point("20.00", -100)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("8.89"), dec("9.67")],
      netPremium: cents(-1100),
      maxGain: cents(3900),
      maxLoss: cents(1100),
    });

    expect(summary.zone).toEqual({ kind: "between", lower: dec("8.89"), upper: dec("9.67") });
    expect(summary.isDebit).toBe(true);
  });

  it("classifies a credit condor as a profit range between its two break-evens", () => {
    const payoff = [point("110.00", -41500), point("129.00", 8500), point("150.00", -41500)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("122.15"), dec("135.85")],
      netPremium: cents(8500),
      maxGain: cents(8500),
      maxLoss: cents(41500),
    });

    expect(summary.zone).toEqual({ kind: "between", lower: dec("122.15"), upper: dec("135.85") });
    expect(summary.isDebit).toBe(false);
  });

  it("classifies a debit bull call spread as profit above its break-even, capped", () => {
    const payoff = [point("30.00", -6200), point("38.00", 13800), point("40.00", 13800)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("36.62")],
      netPremium: cents(-6200),
      maxGain: cents(13800),
      maxLoss: cents(6200),
    });

    expect(summary.zone).toEqual({ kind: "above", level: dec("36.62") });
    expect(summary.isDebit).toBe(true);
  });

  it("classifies a credit bull put spread as profit above its break-even", () => {
    const payoff = [point("30.00", -15200), point("34.00", 4800), point("40.00", 4800)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("33.52")],
      netPremium: cents(4800),
      maxGain: cents(4800),
      maxLoss: cents(15200),
    });

    expect(summary.zone).toEqual({ kind: "above", level: dec("33.52") });
    expect(summary.isDebit).toBe(false);
  });

  it("classifies a long call as profit above its break-even, unbounded", () => {
    const payoff = [point("20.00", -9500), point("30.00", -9500), point("40.00", 105000)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("29.95")],
      netPremium: cents(-9500),
      maxGain: "unbounded",
      maxLoss: cents(9500),
    });

    expect(summary.zone).toEqual({ kind: "above", level: dec("29.95") });
    expect(summary.isDebit).toBe(true);
  });

  it("classifies a long put as profit below its break-even, capped", () => {
    const payoff = [point("20.00", 190000), point("40.00", -12000), point("50.00", -12000)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("38.00")],
      netPremium: cents(-12000),
      maxGain: cents(190000),
      maxLoss: cents(12000),
    });

    expect(summary.zone).toEqual({ kind: "below", level: dec("38.00") });
    expect(summary.isDebit).toBe(true);
  });

  it("classifies a credit bear call spread as profit below its break-even", () => {
    const payoff = [point("20.00", 5000), point("35.00", -10000), point("50.00", -10000)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("32.00")],
      netPremium: cents(5000),
      maxGain: cents(5000),
      maxLoss: cents(10000),
    });

    expect(summary.zone).toEqual({ kind: "below", level: dec("32.00") });
    expect(summary.isDebit).toBe(false);
  });

  it("classifies a long straddle as profit outside its two break-evens", () => {
    const payoff = [point("50.00", 110000), point("62.00", -31000), point("75.00", 100000)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("58.90"), dec("65.10")],
      netPremium: cents(-31000),
      maxGain: "unbounded",
      maxLoss: cents(31000),
    });

    expect(summary.zone).toEqual({ kind: "outside", lower: dec("58.90"), upper: dec("65.10") });
    expect(summary.isDebit).toBe(true);
  });

  it("classifies a short strangle as profit between its two break-evens, loss outside", () => {
    const payoff = [point("50.00", -20000), point("62.00", 15000), point("75.00", -20000)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("58.00"), dec("66.00")],
      netPremium: cents(15000),
      maxGain: cents(15000),
      maxLoss: cents(20000),
    });

    expect(summary.zone).toEqual({ kind: "between", lower: dec("58.00"), upper: dec("66.00") });
    expect(summary.isDebit).toBe(false);
  });

  it("falls back to unclassified with no break-even to anchor a shape", () => {
    const payoff = [point("20.00", 100), point("30.00", 200)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [],
      netPremium: cents(-100),
      maxGain: cents(500),
      maxLoss: cents(100),
    });

    expect(summary.zone).toEqual({ kind: "unclassified" });
  });

  it("falls back to unclassified with more break-evens than a pay/receive sentence can state", () => {
    const payoff = [
      point("10.00", -100),
      point("20.00", 100),
      point("30.00", -100),
      point("40.00", 100),
    ];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("15.00"), dec("25.00"), dec("35.00")],
      netPremium: cents(-100),
      maxGain: cents(100),
      maxLoss: cents(100),
    });

    expect(summary.zone).toEqual({ kind: "unclassified" });
  });

  it("falls back to unclassified when the curve's signs do not agree with a single break-even", () => {
    const payoff = [point("10.00", 100), point("20.00", 100)];
    const summary = summarizePayoff({
      payoff,
      breakEvens: [dec("15.00")],
      netPremium: cents(100),
      maxGain: cents(100),
      maxLoss: cents(100),
    });

    expect(summary.zone).toEqual({ kind: "unclassified" });
  });
});

describe("payoffSummarySentence", () => {
  it("renders the debit range sentence (butterfly)", () => {
    const summary = summarizePayoff({
      payoff: [point("8.00", -1100), point("9.28", 3900), point("20.00", -100)],
      breakEvens: [dec("8.89"), dec("9.67")],
      netPremium: cents(-1100),
      maxGain: cents(3900),
      maxLoss: cents(1100),
    });

    expect(payoffSummarySentence(summary, { ticker: TICKER, date: DATE })).toBe(
      "Você paga R$ 11,00 e ganha até R$ 39,00 se DIRR3 fechar entre R$ 8,89 e R$ 9,67 em 18/12/2026. Fora dessa faixa, perde até os R$ 11,00 que pagou.",
    );
  });

  it("renders the credit range sentence (iron condor)", () => {
    const summary = summarizePayoff({
      payoff: [point("110.00", -41500), point("129.00", 8500), point("150.00", -41500)],
      breakEvens: [dec("122.15"), dec("135.85")],
      netPremium: cents(8500),
      maxGain: cents(8500),
      maxLoss: cents(41500),
    });

    expect(payoffSummarySentence(summary, { ticker: "BOVA11", date: "16/01/2027" })).toBe(
      "Você recebe R$ 85,00 agora e fica com eles se BOVA11 fechar entre R$ 122,15 e R$ 135,85 em 16/01/2027. Fora dessa faixa, pode perder até R$ 415,00.",
    );
  });

  it("renders the debit-above sentence with a capped gain (bull call spread)", () => {
    const summary = summarizePayoff({
      payoff: [point("30.00", -6200), point("38.00", 13800), point("40.00", 13800)],
      breakEvens: [dec("36.62")],
      netPremium: cents(-6200),
      maxGain: cents(13800),
      maxLoss: cents(6200),
    });

    expect(payoffSummarySentence(summary, { ticker: "PETR4", date: "16/01/2027" })).toBe(
      "Você paga R$ 62,00 e ganha se PETR4 fechar acima de R$ 36,62 em 16/01/2027, até R$ 138,00. Abaixo disso, perde até os R$ 62,00 que pagou.",
    );
  });

  it("renders the debit-above sentence with an unbounded gain (long call)", () => {
    const summary = summarizePayoff({
      payoff: [point("20.00", -9500), point("30.00", -9500), point("40.00", 105000)],
      breakEvens: [dec("29.95")],
      netPremium: cents(-9500),
      maxGain: "unbounded",
      maxLoss: cents(9500),
    });

    expect(payoffSummarySentence(summary, { ticker: "BBAS3", date: "16/01/2027" })).toBe(
      "Você paga R$ 95,00 e ganha se BBAS3 fechar acima de R$ 29,95 em 16/01/2027, sem limite de ganho. Abaixo disso, perde até os R$ 95,00 que pagou.",
    );
  });

  it("renders the credit-above sentence (bull put spread)", () => {
    const summary = summarizePayoff({
      payoff: [point("30.00", -15200), point("34.00", 4800), point("40.00", 4800)],
      breakEvens: [dec("33.52")],
      netPremium: cents(4800),
      maxGain: cents(4800),
      maxLoss: cents(15200),
    });

    expect(payoffSummarySentence(summary, { ticker: "ITUB4", date: "16/01/2027" })).toBe(
      "Você recebe R$ 48,00 agora e fica com eles se ITUB4 fechar acima de R$ 33,52 em 16/01/2027. Abaixo disso, pode perder até R$ 152,00.",
    );
  });

  it("renders the debit-below sentence (long put)", () => {
    const summary = summarizePayoff({
      payoff: [point("20.00", 190000), point("40.00", -12000), point("50.00", -12000)],
      breakEvens: [dec("38.00")],
      netPremium: cents(-12000),
      maxGain: cents(190000),
      maxLoss: cents(12000),
    });

    expect(payoffSummarySentence(summary, { ticker: "VALE3", date: "16/01/2027" })).toBe(
      "Você paga R$ 120,00 e ganha se VALE3 fechar abaixo de R$ 38,00 em 16/01/2027, até R$ 1.900,00. Acima disso, perde até os R$ 120,00 que pagou.",
    );
  });

  it("renders the credit-below sentence (bear call spread)", () => {
    const summary = summarizePayoff({
      payoff: [point("20.00", 5000), point("35.00", -10000), point("50.00", -10000)],
      breakEvens: [dec("32.00")],
      netPremium: cents(5000),
      maxGain: cents(5000),
      maxLoss: cents(10000),
    });

    expect(payoffSummarySentence(summary, { ticker: "ITSA4", date: "16/01/2027" })).toBe(
      "Você recebe R$ 50,00 agora e fica com eles se ITSA4 fechar abaixo de R$ 32,00 em 16/01/2027. Acima disso, pode perder até R$ 100,00.",
    );
  });

  it("renders the debit-outside sentence (straddle)", () => {
    const summary = summarizePayoff({
      payoff: [point("50.00", 110000), point("62.00", -31000), point("75.00", 100000)],
      breakEvens: [dec("58.90"), dec("65.10")],
      netPremium: cents(-31000),
      maxGain: "unbounded",
      maxLoss: cents(31000),
    });

    expect(payoffSummarySentence(summary, { ticker: "VALE3", date: "16/01/2027" })).toBe(
      "Você paga R$ 310,00 e ganha se VALE3 fechar abaixo de R$ 58,90 ou acima de R$ 65,10 em 16/01/2027. Entre os dois, perde até os R$ 310,00 que pagou.",
    );
  });

  it("renders the outside-credit sentence", () => {
    const summary = summarizePayoff({
      payoff: [point("50.00", 100), point("62.00", -20000), point("75.00", 100)],
      breakEvens: [dec("58.00"), dec("66.00")],
      netPremium: cents(5000),
      maxGain: "unbounded",
      maxLoss: cents(20000),
    });

    expect(payoffSummarySentence(summary, { ticker: "VALE3", date: "16/01/2027" })).toBe(
      "Você recebe R$ 50,00 agora e fica com eles se VALE3 fechar abaixo de R$ 58,00 ou acima de R$ 66,00 em 16/01/2027. Entre os dois, pode perder até R$ 200,00.",
    );
  });

  it("renders the covered-call sentence when a stock leg sets the debit", () => {
    const summary = summarizePayoff({
      payoff: [point("30.00", -341200), point("36.00", 18800), point("40.00", 18800)],
      breakEvens: [dec("34.12")],
      netPremium: cents(-341200),
      maxGain: cents(18800),
      maxLoss: cents(341200),
    });

    expect(
      payoffSummarySentence(summary, { ticker: "ITUB4", date: "16/01/2027", hasStockLeg: true }),
    ).toBe(
      "Você paga R$ 3.412,00 pelas ações, já descontado o que recebe pela call, e ganha até R$ 188,00 se ITUB4 fechar acima de R$ 34,12 em 16/01/2027. Abaixo de R$ 34,12, fica no prejuízo.",
    );
  });

  it("renders the fallback sentence when the shape cannot be named by a break-even", () => {
    const summary = summarizePayoff({
      payoff: [point("20.00", 100), point("30.00", 200)],
      breakEvens: [],
      netPremium: cents(-100),
      maxGain: cents(500),
      maxLoss: cents(100),
    });

    expect(payoffSummarySentence(summary, { ticker: "VALE3", date: "16/01/2027" })).toBe(
      "Você paga R$ 1,00. Ganha até R$ 5,00, perde até R$ 1,00.",
    );
  });

  it("renders the fallback sentence for a credit with an unbounded loss", () => {
    const summary = summarizePayoff({
      payoff: [point("20.00", 100), point("30.00", -200)],
      breakEvens: [dec("25.00"), dec("26.00"), dec("27.00")],
      netPremium: cents(100),
      maxGain: cents(100),
      maxLoss: "unbounded",
    });

    expect(payoffSummarySentence(summary, { ticker: "VALE3", date: "16/01/2027" })).toBe(
      "Você recebe R$ 1,00 agora. Ganha até R$ 1,00, pode perder sem limite.",
    );
  });
});

describe("gainToRiskRatio", () => {
  it("divides max gain by max loss to one decimal place", () => {
    expect(gainToRiskRatio(cents(3900), cents(1100))).toBe("3,5×");
  });

  it("returns an em dash when the gain is unbounded", () => {
    expect(gainToRiskRatio("unbounded", cents(1100))).toBe("—");
  });

  it("returns an em dash when the loss is unbounded", () => {
    expect(gainToRiskRatio(cents(3900), "unbounded")).toBe("—");
  });

  it("returns an em dash when there is no loss to risk", () => {
    expect(gainToRiskRatio(cents(3900), cents(0))).toBe("—");
  });
});
