import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { centavosSchema, decimalStringSchema, sessionDateSchema } from "@fetha/contracts";

import type { SuggestionView } from "../suggestion-view";
import { SuggestionRow } from "./suggestion-row";

const decimal = (value: string) => decimalStringSchema.parse(value);
const cents = (value: number) => centavosSchema.parse(value);

function point(underlying: string, pnl: number) {
  return { underlying: decimal(underlying), pnl: cents(pnl) };
}

function suggestion(): SuggestionView {
  return {
    id: "s1",
    underlying: "DIRR3",
    session: sessionDateSchema.parse("2026-11-19"),
    horizon: sessionDateSchema.parse("2026-12-18"),
    recipe: {
      id: "call-butterfly",
      expectedMove: "sideways",
      ivRegime: "mid",
      definition: {
        name: "Borboleta com calls",
        structureId: "call-butterfly",
        strikes: [],
        entry: {
          kind: "compare",
          left: { kind: "price", field: "close" },
          comparator: ">",
          right: { kind: "constant", value: decimal("8") },
        },
        exit: [],
      },
    } as unknown as SuggestionView["recipe"],
    recipeId: "call-butterfly-mid-iv",
    structure: { id: "call-butterfly", name: "Borboleta com calls" },
    reading: null,
    facts: { close: decimal("9.25"), indicators: [] },
    legs: [],
    entryLegs: [],
    pricing: {
      at: "2026-11-19T21:00:00.000Z",
      underlying: "DIRR3",
      spot: decimal("9.25"),
      riskFreeRate: decimal("0.1"),
      dividendYield: decimal("0"),
      legs: [],
      netPremium: cents(-1100),
      greeks: {
        delta: decimal("3"),
        gamma: decimal("1"),
        theta: decimal("0.05"),
        vega: decimal("0.1"),
        rho: decimal("0"),
      },
      payoff: [point("8.00", -1100), point("9.28", 3900), point("20.00", -100)],
      breakEvens: [decimal("8.89"), decimal("9.67")],
      maxLoss: cents(1100),
      maxGain: cents(3900),
      limitBreaches: [],
      notes: [],
      provenance: "computed",
    } as unknown as SuggestionView["pricing"],
    maxLoss: cents(1100),
    claim: { kind: "operation_pnl_positive" },
    validity: "valid" as unknown as SuggestionView["validity"],
  };
}

describe("SuggestionRow", () => {
  it("is collapsed by default, with aria-expanded false", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionRow, { suggestion: suggestion(), risk: null, actions: null }),
    );
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows the title, the numbers and the profit zone", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionRow, { suggestion: suggestion(), risk: null, actions: null }),
    );
    expect(html).toContain("Borboleta com calls em DIRR3");
    expect(html).toContain("Arrisca");
    expect(html).toContain("R$ 11,00");
    expect(html).toContain("ganha até");
    expect(html).toContain("R$ 39,00");
    expect(html).toContain("Lucro entre");
    expect(html).toContain("R$ 8,89");
    expect(html).toContain("R$ 9,67");
    expect(html).toContain("vence 18/12/2026");
  });

  it("never lets a money value break between the R$ sign and its figure", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionRow, { suggestion: suggestion(), risk: null, actions: null }),
    );
    expect(html).toContain(
      '<b class="text-foreground font-mono tabular-nums whitespace-nowrap">R$ 11,00</b>',
    );
    expect(html).toContain(
      '<b class="font-mono tabular-nums whitespace-nowrap" style="color:var(--up)">R$ 39,00</b>',
    );
    expect(html).toContain('<span class="whitespace-nowrap">R$ 8,89</span>');
    expect(html).toContain('<span class="whitespace-nowrap">R$ 9,67</span>');
  });

  it("omits the zone phrase and keeps the expiry when the shape cannot be classified", () => {
    const unclassified = suggestion();
    unclassified.pricing = {
      ...unclassified.pricing,
      breakEvens: [],
      payoff: [point("8.00", 0), point("9.00", 0)],
    };
    const html = renderToStaticMarkup(
      createElement(SuggestionRow, { suggestion: unclassified, risk: null, actions: null }),
    );
    expect(html).not.toContain("Lucro");
    expect(html).toContain("vence 18/12/2026");
  });

  it("shows no limit when the gain is unbounded", () => {
    const unbounded = suggestion();
    unbounded.pricing = {
      ...unbounded.pricing,
      maxGain: "unbounded",
    } as unknown as SuggestionView["pricing"];
    const html = renderToStaticMarkup(
      createElement(SuggestionRow, { suggestion: unbounded, risk: null, actions: null }),
    );
    expect(html).toContain("sem limite");
  });

  it("mounts nothing of the full card while collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionRow, { suggestion: suggestion(), risk: null, actions: null }),
    );
    expect(html).not.toContain('data-testid="suggestion-card"');
  });
});
