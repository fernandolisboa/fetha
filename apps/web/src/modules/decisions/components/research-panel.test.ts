import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";
import { assetReadingThresholds, type AssetReading } from "@fetha/engine";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../research-actions", () => ({ obtainSuggestionsAction: vi.fn() }));

import type { ResearchIdeaView, ResearchView } from "../research-view";
import { ResearchPanel } from "./research-panel";

const session = (value: string) => sessionDateSchema.parse(value);
const decimal = (value: string) => decimalStringSchema.parse(value);

const reading: AssetReading = {
  ticker: tickerSchema.parse("PETR4"),
  session: session("2026-10-23"),
  close: decimal("38.50"),
  trend: { label: "up", smaShort: decimal("37"), smaLong: decimal("35") },
  momentum: { label: "neutral", rsi: decimal("55") },
  range: { label: "calm", atr: decimal("0.8"), atrShare: decimal("0.02") },
  impliedVolatility: { label: "low", ivRank: decimal("20"), latest: null },
  options: { label: "liquid", session: session("2026-10-23"), tradedSeries: 30, nextExpiries: [] },
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

function ideaView(
  id: string,
  verdict: ResearchIdeaView["verdict"],
  overrides: Partial<ResearchIdeaView> = {},
): ResearchIdeaView {
  return {
    id,
    verdict,
    justification: `Porque ${id}.`,
    aiAlerts: ["low_liquidity"],
    cited: [{ label: "Lote · Perda máxima", value: "R$ 120,00" }],
    decision: null,
    defaultHorizon: session("2026-11-20"),
    card: {
      underlying: tickerSchema.parse("PETR4"),
      recipeId: "bull-call-spread-low-iv",
      structure: { id: "bull-call-spread", name: "Trava de alta com calls" },
      foundOn: session("2026-10-21"),
      expiry: session("2026-11-20"),
      sessionsToExpiry: 20,
      legs: [],
      netPremium: centavosSchema.parse(-12000),
      maxLoss: centavosSchema.parse(12000),
      maxGain: centavosSchema.parse(8000),
      breakEvens: [decimal("39.70")],
      reading,
      alerts: [],
      suggestionId: null,
      chart: { payoff: [], spot: decimal("39.00") },
    },
    ...overrides,
  };
}

function view(
  groups: Partial<ResearchView["groups"]>,
  rest: Partial<ResearchView> = {},
): ResearchView {
  return {
    id: "research-1",
    createdAt: new Date("2026-10-24T17:32:00Z"),
    model: "claude-opus-5-5",
    newestClose: session("2026-10-23"),
    overview: "Visão geral da pesquisa.",
    sessionsLooked: 3,
    candidates: 16,
    dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 },
    usingDefaultProfile: false,
    supersededBy: null,
    groups: { enter: [], wait: [], do_not_enter: [], ...groups },
    unsent: [],
    ...rest,
  };
}

const render = (stored: ResearchView | null) =>
  renderToStaticMarkup(createElement(ResearchPanel, { stored }));

describe("ResearchPanel", () => {
  it("offers 'Obter sugestões' and nothing else when no research is stored", () => {
    const html = render(null);
    expect(html).toContain("Obter sugestões");
    expect(html).not.toContain("Pesquisar de novo");
    expect(html).not.toContain("research-result");
  });

  it("shows the stored research with its stamp, overview and the button reading 'Pesquisar de novo'", () => {
    const html = render(view({ enter: [ideaView("a", "enter")] }));
    expect(html).toContain("Pesquisar de novo");
    expect(html).toContain("Visão geral da pesquisa.");
    expect(html).toMatch(/Pesquisa de \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2} · Claude Opus 5\.5/);
  });

  it("voices each card's headline by verdict and groups them", () => {
    const html = render(
      view({
        enter: [ideaView("a", "enter")],
        wait: [ideaView("b", "wait")],
        do_not_enter: [ideaView("c", "do_not_enter")],
      }),
    );
    expect(html).toContain("Eu entraria: Trava de alta com calls em PETR4.");
    expect(html).toContain("Eu esperaria: Trava de alta com calls em PETR4.");
    expect(html).not.toContain("Eu não entraria");
    expect(html).toContain("Vale a pena");
    expect(html).toContain("Com ressalva");
    expect(html).toContain("1 ideia descartada, ver por quê");
    expect(html.indexOf("Vale a pena")).toBeLessThan(html.indexOf("Com ressalva"));
  });

  it("keeps the discarded ideas out of the page until the group is opened", () => {
    const html = render(view({ do_not_enter: [ideaView("c", "do_not_enter")] }));
    expect(html).not.toContain("Eu não entraria");
    expect(html).not.toContain("Porque c.");
    expect(html).toMatch(/<button[^>]*>1 ideia descartada, ver por quê/);
  });

  it("says no idea is worth it, with the size of the search, when nothing is 'enter'", () => {
    const html = render(view({ wait: [ideaView("b", "wait")] }));
    expect(html).toContain("Olhei 16 ideias de 3 pregões e nenhuma vale a pena hoje.");
    expect(render(view({ enter: [ideaView("a", "enter")] }))).not.toContain("nenhuma vale a pena");
  });

  it("draws the AI's alerts as chips apart from the engine's", () => {
    const html = render(view({ enter: [ideaView("a", "enter")] }));
    expect(html).toContain('aria-label="Alertas do Fetha"');
    expect(html).toContain("Pouca liquidez");
  });

  it("puts the cited facts behind a disclosure, closed by default", () => {
    const html = render(view({ enter: [ideaView("a", "enter")] }));
    expect(html).toContain("Fatos por trás desta opinião");
    expect(html).not.toContain("ideas.");
  });

  it("links the builder with the stored idea's id", () => {
    const html = render(view({ enter: [ideaView("idea-42", "enter")] }));
    expect(html).toContain('href="/carteira/nova-operacao?pesquisa=idea-42"');
    expect(html).toContain("Montar no simulador");
  });

  it("shows the decision already taken instead of the decision bar", () => {
    const decided = ideaView("a", "enter", {
      decision: { kind: "enter", decidedAt: new Date("2026-10-24T18:00:00Z") },
    });
    const html = render(view({ enter: [decided] }));
    expect(html).toContain("Sua decisão: Entrar");
    expect(html).not.toContain("Registrar decisão");
    expect(render(view({ enter: [ideaView("a", "enter")] }))).toContain("Registrar decisão");
  });

  it("takes no decision once the radar read a newer close", () => {
    const html = render(
      view({ enter: [ideaView("a", "enter")] }, { supersededBy: session("2026-10-26") }),
    );
    expect(html).not.toContain("Registrar decisão");
    expect(html).toContain("Arquivada desde o fechamento de 26/10/2026");
  });

  it("states how many ideas were not sent to Fetha, shown with the engine's numbers only", () => {
    const sample = ideaView("a", "enter");
    const html = render(
      view({ enter: [sample] }, { unsent: [sample.card, sample.card, sample.card] }),
    );
    expect(html).toContain("3 ideias não foram enviadas ao Fetha");
  });
});
