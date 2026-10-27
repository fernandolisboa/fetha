import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type AnalysisInputs,
} from "@fetha/contracts";
import type { AssetReading } from "@fetha/engine";

import { citedFactLabel, researchViewOf, researchVerdictOrder } from "./research-view";
import type { StoredResearch, StoredResearchIdea } from "./research-repository";

const session = (value: string) => sessionDateSchema.parse(value);
const decimal = (value: string) => decimalStringSchema.parse(value);

function storedIdea(
  position: number,
  verdict: StoredResearchIdea["verdict"],
  overrides: Partial<StoredResearchIdea> = {},
): StoredResearchIdea {
  return {
    id: `idea-${String(position)}`,
    researchId: "research-1",
    position,
    underlying: `PETR${String(position)}`,
    recipeId: "bull-call-spread-low-iv",
    foundOn: session("2026-10-21"),
    suggestionId: null,
    newestClose: session("2026-10-23"),
    sessionsToExpiry: 20,
    legs: [
      {
        role: "call",
        side: "buy",
        ticker: tickerSchema.parse("PETRK385"),
        strike: decimal("38.5"),
        expiry: session("2026-11-20"),
        quantity: quantitySchema.parse(100),
        price: decimal("1.20"),
      },
    ],
    pricing: {
      netPremium: centavosSchema.parse(-12000),
      maxLoss: centavosSchema.parse(12000),
      maxGain: "unbounded",
      breakEvens: [decimal("39.70")],
    },
    reading: {} as AssetReading,
    engineAlerts: [],
    verdict,
    justification: `Justificativa ${String(position)}`,
    aiAlerts: ["low_liquidity"],
    inputsCited: [`ideas.${String(position)}.pricing.maxLoss`, `ideas.${String(position)}.nothing`],
    claim: { kind: "operation_pnl_positive" },
    horizon: session("2026-11-20"),
    ...overrides,
  };
}

const inputs: AnalysisInputs = {
  subject: "research",
  facts: {
    newestClose: "23/10/2026",
    ideas: [0, 1, 2, 3].map(() => ({ pricing: { maxLoss: "R$ 120,00" } })),
  },
};

function research(ideas: StoredResearchIdea[]): StoredResearch {
  return {
    id: "research-1",
    createdAt: new Date("2026-10-24T17:32:00Z"),
    newestClose: session("2026-10-23"),
    sessionsLooked: 3,
    candidates: 16,
    dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 },
    usingDefaultProfile: false,
    model: "claude-opus-5-5",
    overview: "Visão geral",
    inputs,
    ideas,
  };
}

describe("researchViewOf", () => {
  const ideas = [
    storedIdea(3, "wait"),
    storedIdea(0, "do_not_enter"),
    storedIdea(2, "enter"),
    storedIdea(1, "enter"),
  ];

  it("groups the ideas by verdict, each group in the engine's order", () => {
    const view = researchViewOf({
      research: research(ideas),
      decisions: new Map(),
      newestReadSession: session("2026-10-23"),
    });
    expect(researchVerdictOrder).toEqual(["enter", "wait", "do_not_enter"]);
    expect(view.groups.enter.map((idea) => idea.id)).toEqual(["idea-1", "idea-2"]);
    expect(view.groups.wait.map((idea) => idea.id)).toEqual(["idea-3"]);
    expect(view.groups.do_not_enter.map((idea) => idea.id)).toEqual(["idea-0"]);
  });

  it("redraws each card from the stored lot", () => {
    const view = researchViewOf({
      research: research([storedIdea(0, "enter")]),
      decisions: new Map(),
      newestReadSession: session("2026-10-23"),
    });
    const [first] = view.groups.enter;
    expect(first?.card).toMatchObject({
      underlying: "PETR0",
      structure: { id: "bull-call-spread", name: "Trava de alta com calls" },
      expiry: "2026-11-20",
      netPremium: -12000,
      maxLoss: 12000,
      maxGain: "unbounded",
      breakEvens: ["39.70"],
    });
    expect(first?.defaultHorizon).toBe("2026-11-20");
  });

  it("labels the cited facts and shows only the values it can read", () => {
    const view = researchViewOf({
      research: research([storedIdea(0, "enter")]),
      decisions: new Map(),
      newestReadSession: session("2026-10-23"),
    });
    expect(view.groups.enter[0]?.cited).toEqual([
      { label: "Lote · Perda máxima", value: "R$ 120,00" },
      { label: "nothing", value: null },
    ]);
  });

  it("marks the ideas that already have a decision", () => {
    const decidedAt = new Date("2026-10-24T18:00:00Z");
    const view = researchViewOf({
      research: research([storedIdea(0, "enter"), storedIdea(1, "enter")]),
      decisions: new Map([["idea-1", { kind: "enter" as const, decidedAt }]]),
      newestReadSession: session("2026-10-23"),
    });
    expect(view.groups.enter.map((idea) => idea.decision)).toEqual([
      null,
      { kind: "enter", decidedAt },
    ]);
  });

  it("is superseded only when the radar read a newer close than the research's", () => {
    const base = { research: research([storedIdea(0, "enter")]), decisions: new Map() };
    expect(researchViewOf({ ...base, newestReadSession: session("2026-10-23") }).supersededBy).toBe(
      null,
    );
    expect(researchViewOf({ ...base, newestReadSession: null }).supersededBy).toBe(null);
    expect(researchViewOf({ ...base, newestReadSession: session("2026-10-26") }).supersededBy).toBe(
      "2026-10-26",
    );
  });

  it("carries the ideas past the cut only when given", () => {
    const base = {
      research: research([storedIdea(0, "enter")]),
      decisions: new Map(),
      newestReadSession: session("2026-10-23"),
    };
    expect(researchViewOf(base).unsent).toEqual([]);
  });

  it("falls back to the recipe id when the recipe left the book", () => {
    const view = researchViewOf({
      research: research([storedIdea(0, "enter", { recipeId: "gone" })]),
      decisions: new Map(),
      newestReadSession: session("2026-10-23"),
    });
    expect(view.groups.enter[0]?.card.structure).toEqual({ id: "gone", name: "gone" });
  });
});

describe("citedFactLabel", () => {
  it("drops the idea's own prefix and names each segment", () => {
    expect(citedFactLabel("ideas.3.pricing.maxLoss")).toBe("Lote · Perda máxima");
    expect(citedFactLabel("ideas.0.recipeTrackRecord.claimHeldShare")).toBe(
      "Histórico da receita · Teses confirmadas",
    );
  });

  it("counts list positions from one", () => {
    expect(citedFactLabel("ideas.1.filings.0.summary")).toBe("Comunicados · #1 · Resumo");
    expect(citedFactLabel("ideas.1.pricing.breakEvens.1")).toBe("Lote · Break-evens · #2");
  });

  it("keeps a segment it has no label for", () => {
    expect(citedFactLabel("ideas.2.somethingNew")).toBe("somethingNew");
    expect(citedFactLabel("newestClose")).toBe("Fechamento lido");
  });
});
