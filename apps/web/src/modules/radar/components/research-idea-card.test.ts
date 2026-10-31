import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";
import { assetReadingThresholds, type AssetReading } from "@fetha/engine";

import type { IdeaCard } from "../research";
import { ResearchIdeaCard } from "./research-idea-card";

const decimal = (value: string) => decimalStringSchema.parse(value);

const reading: AssetReading = {
  ticker: tickerSchema.parse("PETR4"),
  session: sessionDateSchema.parse("2026-10-23"),
  close: decimal("38.50"),
  trend: { label: "up", smaShort: decimal("37"), smaLong: decimal("35") },
  momentum: { label: "neutral", rsi: decimal("55") },
  range: { label: "calm", atr: decimal("0.8"), atrShare: decimal("0.02") },
  impliedVolatility: { label: "low", ivRank: decimal("20"), latest: null },
  options: {
    label: "liquid",
    session: sessionDateSchema.parse("2026-10-23"),
    tradedSeries: 30,
    nextExpiries: [],
  },
  thresholds: assetReadingThresholds,
  notes: [],
  provenance: {
    engineVersion: "test",
    pricingModel: "bsm_continuous_yield",
    truncated: [],
    dataVersion: null,
    datasetNotes: [],
  },
};

function idea(overrides: Partial<IdeaCard> = {}): IdeaCard {
  return {
    underlying: tickerSchema.parse("PETR4"),
    recipeId: "bull-call-spread-low-iv",
    structure: { id: "bull-call-spread", name: "Trava de alta com calls" },
    foundOn: sessionDateSchema.parse("2026-10-21"),
    expiry: sessionDateSchema.parse("2026-11-20"),
    sessionsToExpiry: 20,
    legs: [
      {
        role: "call",
        side: "buy",
        ticker: tickerSchema.parse("PETRK385"),
        strike: decimal("38.5"),
        expiry: sessionDateSchema.parse("2026-11-20"),
        quantity: quantitySchema.parse(100),
        price: decimal("1.20"),
      },
      {
        role: "call",
        side: "sell",
        ticker: tickerSchema.parse("PETRK405"),
        strike: decimal("40.5"),
        expiry: sessionDateSchema.parse("2026-11-20"),
        quantity: quantitySchema.parse(100),
        price: decimal("0.50"),
      },
    ],
    netPremium: centavosSchema.parse(-7000),
    maxLoss: centavosSchema.parse(7000),
    maxGain: centavosSchema.parse(13000),
    breakEvens: [decimal("39.2")],
    reading,
    alerts: [],
    suggestionId: "abc",
    chart: {
      payoff: [
        { underlying: decimal("38.5"), pnl: centavosSchema.parse(-7000) },
        { underlying: decimal("40.5"), pnl: centavosSchema.parse(13000) },
      ],
      spot: decimal("39.06"),
    },
    ...overrides,
  };
}

function render(value: IdeaCard, options: { stale?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(ResearchIdeaCard, { idea: value, ...options }));
}

describe("ResearchIdeaCard", () => {
  it("draws the lot's payoff at expiry with the close it was priced at", () => {
    const html = render(idea());

    expect(html).toContain('data-testid="payoff-chart"');
    expect(html).toContain("Fechamento R$ 39,06");
  });

  it("draws no payoff chart when the engine sampled no points", () => {
    expect(render(idea({ chart: { payoff: [], spot: decimal("39.06") } }))).not.toContain(
      "payoff-chart",
    );
  });

  it("shows the re-priced lot, the original finding and links to the suggestion and the asset", () => {
    const html = render(idea());

    expect(html).toContain("Trava de alta com calls em PETR4");
    expect(html).toContain("O radar achou no fechamento de 21/10/2026.");
    expect(html).toContain("100 ×");
    expect(html).toContain("−R$ 70,00");
    expect(html).toContain("Vence em 20/11/2026, daqui a 20 pregões");
    expect(html).toContain('href="/sugestoes/abc"');
    expect(html).toContain('href="/ativos/PETR4"');
    expect(html).not.toContain("Alertas");
  });

  it("leaves out the suggestion link for an idea no suggestion was stored for", () => {
    const html = render(idea({ suggestionId: null }));

    expect(html).not.toContain("/sugestoes/");
    expect(html).toContain('href="/ativos/PETR4"');
  });

  it("lists each alert: the rule that stopped holding, the breached limits and the near expiry", () => {
    const html = render(
      idea({
        alerts: [
          { kind: "rule_no_longer_holds", foundOn: sessionDateSchema.parse("2026-10-21") },
          {
            kind: "limit_breach",
            breach: {
              limit: "maxLossPerOperation",
              value: decimal("0.04"),
              allowed: decimal("0.02"),
            },
          },
          { kind: "near_expiry", sessionsLeft: 7 },
        ],
      }),
    );

    expect(html).toContain("A regra da receita deixou de valer");
    expect(html).toContain("21/10/2026");
    expect(html).toContain("Vence em 7 pregões");
    expect(html).toContain('data-testid="risk-notice"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("4%");
  });

  it("keeps each break-even in one piece", () => {
    const html = render(idea({ breakEvens: [decimal("11.48"), decimal("11.52")] }));

    expect(html).toContain('<span class="whitespace-nowrap">R$ 11,48</span> / <span');
  });

  it("marks a card whose rule stopped holding with the warning border", () => {
    expect(render(idea(), { stale: true })).toContain("var(--warning)");
    expect(render(idea())).not.toContain("var(--warning)");
  });
});
