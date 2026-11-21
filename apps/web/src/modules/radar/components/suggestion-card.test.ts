import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { centavosSchema, decimalStringSchema, sessionDateSchema } from "@fetha/contracts";

import type { SuggestionView } from "../suggestion-view";
import { SuggestionCardHeader, SuggestionDetails } from "./suggestion-card";

const decimal = (value: string) => decimalStringSchema.parse(value);

function suggestion(): SuggestionView {
  return {
    id: "s1",
    underlying: "PETR4",
    session: sessionDateSchema.parse("2026-10-21"),
    horizon: sessionDateSchema.parse("2026-11-20"),
    recipe: {
      id: "bull-call-spread-low-iv",
      expectedMove: "up",
      ivRegime: "low",
      definition: {
        name: "Trava de alta com calls",
        structureId: "bull-call-spread",
        strikes: [],
        entry: {
          kind: "compare",
          left: { kind: "price", field: "close" },
          comparator: ">",
          right: { kind: "constant", value: decimal("40") },
        },
        exit: [],
      },
    } as unknown as SuggestionView["recipe"],
    recipeId: "bull-call-spread-low-iv",
    structure: { id: "bull-call-spread", name: "Trava de alta com calls" },
    reading: null,
    facts: { close: decimal("45.70"), indicators: [] },
    legs: [],
    entryLegs: [],
    pricing: {} as unknown as SuggestionView["pricing"],
    maxLoss: centavosSchema.parse(100),
    claim: { kind: "operation_pnl_positive" },
    validity: "valid" as unknown as SuggestionView["validity"],
  };
}

describe("SuggestionCardHeader", () => {
  it("shows the title, the Cenário chip and the expiry chip", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionCardHeader, {
        suggestion: suggestion(),
        headline: true,
        chipKind: null,
      }),
    );
    expect(html).toContain("Trava de alta com calls em PETR4");
    expect(html).toContain("Cenário: alta");
    expect(html).toContain("Vence 20/11/2026");
  });

  it("shows no premium chip for a zero-premium structure", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionCardHeader, {
        suggestion: suggestion(),
        headline: true,
        chipKind: null,
      }),
    );
    expect(html).not.toContain("Débito");
    expect(html).not.toContain("Crédito");
  });

  it("names the premium chip debit or credit when the lot carries a real premium", () => {
    const debit = renderToStaticMarkup(
      createElement(SuggestionCardHeader, {
        suggestion: suggestion(),
        headline: true,
        chipKind: "debit",
      }),
    );
    expect(debit).toContain("Débito");

    const credit = renderToStaticMarkup(
      createElement(SuggestionCardHeader, {
        suggestion: suggestion(),
        headline: true,
        chipKind: "credit",
      }),
    );
    expect(credit).toContain("Crédito");
  });

  it("links to the matching lesson", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionCardHeader, {
        suggestion: suggestion(),
        headline: true,
        chipKind: null,
      }),
    );
    expect(html).toContain('href="/aprender/bull-call-spread"');
    expect(html).toContain("Aprender: Trava de alta com calls");
  });

  it("leaves out the lesson link for a structure with no lesson", () => {
    const noLesson = suggestion();
    noLesson.structure = { id: "unknown-structure", name: "Estrutura sem aula" };
    const html = renderToStaticMarkup(
      createElement(SuggestionCardHeader, {
        suggestion: noLesson,
        headline: true,
        chipKind: null,
      }),
    );
    expect(html).not.toContain("/aprender/");
  });

  it("omits the title when headline is false, on the suggestion's own page", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionCardHeader, {
        suggestion: suggestion(),
        headline: false,
        chipKind: null,
      }),
    );
    expect(html).not.toContain("<h3");
  });
});

function greeks(): SuggestionView["pricing"]["greeks"] {
  return {
    delta: decimal("3"),
    gamma: decimal("1"),
    theta: decimal("0.05"),
    vega: decimal("0.1"),
    rho: decimal("0"),
  };
}

describe("SuggestionDetails", () => {
  it("is closed by default", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionDetails, {
        greeks: greeks(),
        legs: [],
        calibration: null,
        claim: { kind: "operation_pnl_positive" },
        underlying: "PETR4",
        horizon: sessionDateSchema.parse("2026-11-20"),
      }),
    );
    expect(html).toContain("data-closed");
    expect(html).not.toContain("data-open=");
  });

  it("the chevron's class targets the Collapsible root's own data-open, not the trigger's data-panel-open", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionDetails, {
        greeks: greeks(),
        legs: [],
        calibration: null,
        claim: { kind: "operation_pnl_positive" },
        underlying: "PETR4",
        horizon: sessionDateSchema.parse("2026-11-20"),
      }),
    );
    expect(html).toContain("group-data-open/details:rotate-90");
    expect(html).not.toContain("group-data-[panel-open]/details");
  });

  it("opens when told to, carrying data-open on the same node the group class sits on", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionDetails, {
        greeks: greeks(),
        legs: [],
        calibration: null,
        claim: { kind: "operation_pnl_positive" },
        underlying: "PETR4",
        horizon: sessionDateSchema.parse("2026-11-20"),
        defaultOpen: true,
      }),
    );
    const rootTag = html.slice(0, html.indexOf(">") + 1);
    expect(rootTag).toContain("data-open");
    expect(rootTag).toContain('class="group/details');
  });
});
