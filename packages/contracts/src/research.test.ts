import { describe, expect, it } from "vitest";

import { analysisObjectKinds, analysisSubjectKinds, type AnalysisInputs } from "./analysis";
import {
  checkResearchCitations,
  checkResearchIdeas,
  researchAlerts,
  researchIdeaPath,
  RESEARCH_MAX_OUTPUT_TOKENS,
  researchOutputSchema,
  type ResearchOutput,
} from "./research";

const inputs: AnalysisInputs = {
  subject: "research",
  facts: {
    newestClose: "26/10/2026",
    ideas: [
      {
        underlying: "PETR4",
        structure: "Trava de alta com calls",
        pricing: { maxLoss: "−R$ 120,00", breakEvens: ["R$ 32,20"] },
        engineAlerts: ["near_expiry"],
      },
      {
        underlying: "VALE3",
        structure: "Compra de call",
        pricing: { maxLoss: "−R$ 300,00", breakEvens: ["R$ 65,10"] },
        engineAlerts: [],
      },
    ],
  },
};

function reply(overrides: Partial<ResearchOutput> = {}): ResearchOutput {
  return {
    overview: "Das duas ideias, só a primeira tem risco que cabe no bolso.",
    ideas: [
      {
        idea: "ideas.0",
        verdict: "enter",
        justification: "A perda máxima é de −R$ 120,00 e o break-even fica em R$ 32,20.",
        alerts: ["near_expiry"],
        inputsCited: ["ideas.0.pricing.maxLoss", "ideas.0.pricing.breakEvens.0"],
      },
      {
        idea: "ideas.1",
        verdict: "do_not_enter",
        justification: "A perda máxima de −R$ 300,00 é grande para o prêmio.",
        alerts: [],
        inputsCited: ["ideas.1.pricing.maxLoss"],
      },
    ],
    ...overrides,
  };
}

describe("analysis subjects", () => {
  it("research is a subject of its own, apart from the single-object ones", () => {
    expect(analysisSubjectKinds).toContain("research");
    expect(analysisObjectKinds).not.toContain("research");
    expect(analysisObjectKinds).toHaveLength(analysisSubjectKinds.length - 1);
  });
});

describe("researchOutputSchema", () => {
  it("accepts a reply that answers each idea with a closed verdict", () => {
    expect(researchOutputSchema.safeParse(reply()).success).toBe(true);
  });

  it("refuses a verdict outside the closed list", () => {
    const bad = reply();
    expect(
      researchOutputSchema.safeParse({ ...bad, ideas: [{ ...bad.ideas[0], verdict: "buy" }] })
        .success,
    ).toBe(false);
  });

  it("refuses an alert outside the closed list", () => {
    const bad = reply();
    expect(
      researchOutputSchema.safeParse({ ...bad, ideas: [{ ...bad.ideas[0], alerts: ["panic"] }] })
        .success,
    ).toBe(false);
  });

  it("refuses a repeated alert and more than five alerts", () => {
    const [first] = reply().ideas;
    expect(
      researchOutputSchema.safeParse({
        ...reply(),
        ideas: [{ ...first, alerts: ["near_expiry", "near_expiry"] }],
      }).success,
    ).toBe(false);
    expect(
      researchOutputSchema.safeParse({
        ...reply(),
        ideas: [{ ...first, alerts: researchAlerts.slice(0, 6) }],
      }).success,
    ).toBe(false);
  });

  it("refuses a numeric verdict, an outlook and any field of the contract it does not have", () => {
    const [first] = reply().ideas;
    expect(
      researchOutputSchema.safeParse({ ...reply(), ideas: [{ ...first, verdict: 1 }] }).success,
    ).toBe(false);
    expect(
      researchOutputSchema.safeParse({ ...reply(), ideas: [{ ...first, outlook: null }] }).success,
    ).toBe(false);
  });

  it("refuses a reply with no ideas or an empty overview", () => {
    expect(researchOutputSchema.safeParse(reply({ ideas: [] })).success).toBe(false);
    expect(researchOutputSchema.safeParse(reply({ overview: "  " })).success).toBe(false);
  });
});

describe("checkResearchIdeas", () => {
  it("accepts a reply that covers every idea sent exactly once, in any order", () => {
    const [first, second] = reply().ideas;
    expect(checkResearchIdeas(inputs, reply())).toEqual({ ok: true });
    expect(
      checkResearchIdeas(inputs, reply({ ideas: second && first ? [second, first] : [] })),
    ).toEqual({ ok: true });
  });

  it("reports a skipped idea as missing", () => {
    const [first] = reply().ideas;
    expect(checkResearchIdeas(inputs, reply({ ideas: first ? [first] : [] }))).toEqual({
      ok: false,
      problem: "missing",
    });
  });

  it("reports an idea answered twice as duplicate", () => {
    const [first] = reply().ideas;
    expect(checkResearchIdeas(inputs, reply({ ideas: first ? [first, first] : [] }))).toEqual({
      ok: false,
      problem: "duplicate",
    });
  });

  it("reports a path that was not sent as unknown, even when the count matches", () => {
    const [first, second] = reply().ideas;
    const stray = second ? { ...second, idea: "ideas.7" } : undefined;
    expect(
      checkResearchIdeas(inputs, reply({ ideas: first && stray ? [first, stray] : [] })),
    ).toEqual({ ok: false, problem: "unknown" });
  });

  it("treats a path that is not a position of the list as unknown", () => {
    const [first, second] = reply().ideas;
    const stray = second ? { ...second, idea: "ideas.01" } : undefined;
    expect(
      checkResearchIdeas(inputs, reply({ ideas: first && stray ? [first, stray] : [] })),
    ).toEqual({ ok: false, problem: "unknown" });
  });

  it("names a position the way the facts do", () => {
    expect(researchIdeaPath(3)).toBe("ideas.3");
  });
});

describe("checkResearchCitations", () => {
  it("accepts figures that are in the facts, in the overview and in every justification", () => {
    expect(checkResearchCitations(inputs, reply())).toEqual({ ok: true });
  });

  it("refuses a figure in a justification that no fact holds", () => {
    const [first, second] = reply().ideas;
    const output = reply({
      ideas: [
        first,
        second && { ...second, justification: "Pode render R$ 999,00 se tudo der certo." },
      ].flatMap((entry) => (entry ? [entry] : [])),
    });
    expect(checkResearchCitations(inputs, output)).toEqual({
      ok: false,
      uncitedFigures: ["999,00"],
      unknownPaths: [],
    });
  });

  it("refuses a figure in the overview that no fact holds", () => {
    expect(
      checkResearchCitations(inputs, reply({ overview: "Olhei 7 ideias e nenhuma agrada." })),
    ).toEqual({ ok: false, uncitedFigures: ["7"], unknownPaths: [] });
  });

  it("refuses a cited path that names no fact", () => {
    const [first, second] = reply().ideas;
    const output = reply({
      ideas: [first && { ...first, inputsCited: ["ideas.0.pricing.maxGain"] }, second].flatMap(
        (entry) => (entry ? [entry] : []),
      ),
    });
    expect(checkResearchCitations(inputs, output)).toEqual({
      ok: false,
      uncitedFigures: [],
      unknownPaths: ["ideas.0.pricing.maxGain"],
    });
  });

  it("reads a figure against all the facts, not only the idea's own", () => {
    const [first, second] = reply().ideas;
    const output = reply({
      ideas: [
        first && { ...first, justification: "Comparada à outra, a perda de −R$ 300,00 pesa mais." },
        second,
      ].flatMap((entry) => (entry ? [entry] : [])),
    });
    expect(checkResearchCitations(inputs, output)).toEqual({ ok: true });
  });
});

describe("the reply's size bounds", () => {
  it("keeps twenty ideas at the largest the schema allows within half the token budget", () => {
    const largest: ResearchOutput = {
      overview: "x".repeat(800),
      ideas: Array.from({ length: 20 }, (_, position) => ({
        idea: researchIdeaPath(position),
        verdict: "wait" as const,
        justification: "x".repeat(600),
        alerts: researchAlerts.slice(0, 5),
        inputsCited: Array.from({ length: 8 }, () => "x".repeat(80)),
      })),
    };
    expect(researchOutputSchema.safeParse(largest).success).toBe(true);
    // A conservative three characters to the token, against half the budget: the rest is the
    // model's thinking.
    expect(JSON.stringify(largest).length / 3).toBeLessThan(RESEARCH_MAX_OUTPUT_TOKENS / 2);
  });

  it("refuses a justification, a citation list or an overview past its bound", () => {
    const base = { idea: "ideas.0", verdict: "enter" as const, alerts: [] };
    const idea = { ...base, justification: "ok", inputsCited: ["ideas.0.pricing.maxLoss"] };
    const parse = (ideas: unknown[], overview = "ok") =>
      researchOutputSchema.safeParse({ overview, ideas }).success;
    expect(parse([idea])).toBe(true);
    expect(parse([{ ...idea, justification: "x".repeat(601) }])).toBe(false);
    expect(parse([{ ...idea, inputsCited: Array(9).fill("ideas.0.pricing.maxLoss") }])).toBe(false);
    expect(parse([idea], "x".repeat(801))).toBe(false);
  });
});
