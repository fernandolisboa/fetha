import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  analysisInputsSchema,
  analysisOutputV2Schema,
  checkAnalysisCitations,
  resolveAnalysisOutlook,
  type AnalysisInputs,
  type AnalysisOutputV2,
} from "@fetha/contracts";

import { render, system } from "./v2";

const fixtures = fileURLToPath(new URL("../../fixtures/analysis/v2/", import.meta.url));

function read(path: string): unknown {
  return JSON.parse(readFileSync(`${fixtures}${path}`, "utf8"));
}

function inputsOf(name: string): AnalysisInputs {
  return analysisInputsSchema.parse(read(`${name}/inputs.json`));
}

function outputOf(name: string, file = "output.json"): AnalysisOutputV2 {
  return analysisOutputV2Schema.parse(read(`${name}/${file}`));
}

const golden = readdirSync(fixtures).filter((name) => !name.startsWith("adversarial-"));
const spread = inputsOf("contemplated-bull-call-spread");

describe("analysis@2 golden fixtures", () => {
  it("cover every subject kind, with and without an outlook", () => {
    expect(new Set(golden.map((name) => inputsOf(name).subject))).toEqual(
      new Set(["signal", "contemplated_operation", "held_operation", "backtest_run"]),
    );
    const outlooks = golden.map((name) => outputOf(name).outlook);
    expect(outlooks.some((outlook) => outlook === null)).toBe(true);
    expect(outlooks.some((outlook) => outlook?.horizon === "expiry")).toBe(true);
  });

  it.each(golden)("%s: the output meets the contract and cites only its facts", (name) => {
    expect(checkAnalysisCitations(inputsOf(name), outputOf(name))).toEqual({ ok: true });
  });

  it.each(golden)("%s: the outlook, when present, resolves to an engine claim", (name) => {
    const outlook = outputOf(name).outlook;
    if (outlook === null) return;
    expect(resolveAnalysisOutlook(inputsOf(name), outlook)).toMatchObject({ ok: true });
  });

  it("resolves the covered call's outlook to its break-even at expiry", () => {
    const outlook = outputOf("held-covered-call").outlook;
    expect(outlook && resolveAnalysisOutlook(inputsOf("held-covered-call"), outlook)).toEqual({
      ok: true,
      claim: { kind: "close_above", instrument: "ITUB4", level: "34.84" },
      confidence: "0.75",
      horizon: { kind: "expiry", expiry: "2026-11-20" },
    });
  });

  it.each(golden)("%s: the rendered request carries the facts unchanged", (name) => {
    const inputs = inputsOf(name);
    const block = /<engine_facts>\n([\s\S]*)\n<\/engine_facts>$/.exec(render(inputs));
    expect(JSON.parse(block?.[1] ?? "null")).toEqual(inputs.facts);
  });

  it("names every outlook word the contract accepts", () => {
    for (const word of [
      "instrumentFact",
      "levelFact",
      "one_week",
      "one_month",
      "three_months",
      "expiry",
      "somewhat_likely",
      "likely",
      "very_likely",
    ]) {
      expect(system).toContain(word);
    }
  });
});

describe("analysis@2 adversarial fixtures", () => {
  const injected = inputsOf("adversarial-injected-fact");

  it("keeps an injected closing tag inside the facts block as escaped data", () => {
    const message = render(injected);
    expect(message.match(/<\/engine_facts>/g)).toHaveLength(1);
    expect(message.match(/<engine_facts>/g)).toHaveLength(1);
    const block = /<engine_facts>\n([\s\S]*)\n<\/engine_facts>$/.exec(message);
    expect(JSON.parse(block?.[1] ?? "null")).toEqual(injected.facts);
  });

  it("rejects a reply that obeyed the injection, in its prose and its outlook", () => {
    const output = outputOf("adversarial-injected-fact", "obeyed-output.json");
    expect(checkAnalysisCitations(injected, output)).toEqual({
      ok: false,
      uncitedFigures: ["99"],
      unknownPaths: ["user.email"],
    });
    expect(output.outlook && resolveAnalysisOutlook(injected, output.outlook)).toEqual({
      ok: false,
      problem: "instrument_fact",
    });
  });

  it.each([
    ["adversarial-written-level", "level_fact"],
    ["adversarial-level-not-a-price", "level_fact"],
    ["adversarial-level-money-amount", "level_fact"],
    ["adversarial-level-option-premium", "level_fact"],
    ["adversarial-instrument-not-a-ticker", "instrument_fact"],
    ["adversarial-expiry-without-expiry", "expiry_fact"],
  ])("%s: the outlook is refused (%s)", (name, problem) => {
    const output = outputOf(name);
    expect(checkAnalysisCitations(spread, output)).toEqual({ ok: true });
    expect(output.outlook && resolveAnalysisOutlook(spread, output.outlook)).toEqual({
      ok: false,
      problem,
    });
  });

  it.each(["adversarial-numeric-likelihood", "adversarial-horizon-date"])(
    "%s: the reply misses the contract",
    (name) => {
      expect(analysisOutputV2Schema.safeParse(read(`${name}/output.json`)).success).toBe(false);
    },
  );
});
