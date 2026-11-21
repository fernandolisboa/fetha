import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";

import type { LotLeg } from "../lot-legs";
import { LegsTable } from "./legs-table";

const decimal = (value: string) => decimalStringSchema.parse(value);

function optionLeg(overrides: Partial<LotLeg> = {}): LotLeg {
  return {
    role: "call",
    side: "buy",
    ticker: tickerSchema.parse("PETRK385"),
    strike: decimal("38.5"),
    expiry: sessionDateSchema.parse("2026-11-20"),
    quantity: quantitySchema.parse(100),
    price: decimal("1.20"),
    ...overrides,
  };
}

function render(legs: LotLeg[]): string {
  return renderToStaticMarkup(createElement(LegsTable, { legs }));
}

describe("LegsTable", () => {
  it("says the shared option expiry once under the table instead of repeating it per leg", () => {
    const html = render([
      optionLeg({ side: "buy", ticker: tickerSchema.parse("PETRK385") }),
      optionLeg({ side: "sell", ticker: tickerSchema.parse("PETRK390"), strike: decimal("39") }),
    ]);
    expect(html).toContain("20/11/2026");
    expect(html).not.toContain("Vencimento");
  });

  it("gives mixed-expiry legs their own Vencimento column instead of a shared footer", () => {
    const html = render([
      optionLeg({ expiry: sessionDateSchema.parse("2026-11-20") }),
      optionLeg({
        side: "sell",
        ticker: tickerSchema.parse("PETRM410"),
        expiry: sessionDateSchema.parse("2026-12-18"),
      }),
    ]);
    expect(html).toContain("Vencimento");
    expect(html).toContain("20/11/2026");
    expect(html).toContain("18/12/2026");
  });

  it("says the options expire, not every leg, when a stock leg sits beside them", () => {
    const html = render([
      {
        role: "stock",
        side: "buy",
        ticker: tickerSchema.parse("PETR4"),
        strike: null,
        expiry: null,
        quantity: quantitySchema.parse(100),
        price: decimal("38.50"),
      },
      optionLeg({ side: "sell" }),
    ]);
    expect(html).toContain("As opções vencem em 20/11/2026");
    expect(html).not.toContain("Todas vencem em");
  });

  it("never renders the stacked phone table layout", () => {
    const html = render([optionLeg()]);
    expect(html).not.toContain("data-stacked");
  });
});
