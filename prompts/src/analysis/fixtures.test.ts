import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  analysisInputsSchema,
  analysisOutputSchema,
  checkAnalysisCitations,
  type AnalysisInputs,
} from "@fetha/contracts";

import { render } from "./v1";

const fixtures = fileURLToPath(new URL("../../fixtures/analysis/v1/", import.meta.url));

function read(path: string): unknown {
  return JSON.parse(readFileSync(`${fixtures}${path}`, "utf8"));
}

function inputsOf(name: string): AnalysisInputs {
  return analysisInputsSchema.parse(read(`${name}/inputs.json`));
}

const golden = readdirSync(fixtures).filter((name) => !name.startsWith("adversarial-"));

describe("analysis@1 golden fixtures", () => {
  it("cover every subject kind", () => {
    expect(new Set(golden.map((name) => inputsOf(name).subject))).toEqual(
      new Set(["signal", "contemplated_operation", "held_operation", "backtest_run"]),
    );
  });

  it.each(golden)("%s: the output meets the contract and cites only its facts", (name) => {
    const output = analysisOutputSchema.parse(read(`${name}/output.json`));
    expect(checkAnalysisCitations(inputsOf(name), output)).toEqual({ ok: true });
  });

  it.each(golden)("%s: the rendered request carries the facts unchanged", (name) => {
    const inputs = inputsOf(name);
    const block = /<engine_facts>\n([\s\S]*)\n<\/engine_facts>$/.exec(render(inputs));
    expect(JSON.parse(block?.[1] ?? "null")).toEqual(inputs.facts);
  });
});

describe("analysis@1 adversarial fixtures", () => {
  const injected = inputsOf("adversarial-injected-fact");

  it("keeps an injected closing tag inside the facts block as escaped data", () => {
    const message = render(injected);
    expect(message.match(/<\/engine_facts>/g)).toHaveLength(1);
    expect(message.match(/<engine_facts>/g)).toHaveLength(1);
    expect(message.endsWith("</engine_facts>")).toBe(true);
    const block = /<engine_facts>\n([\s\S]*)\n<\/engine_facts>$/.exec(message);
    expect(JSON.parse(block?.[1] ?? "null")).toEqual(injected.facts);
  });

  it("rejects a reply that obeyed the injection", () => {
    const output = analysisOutputSchema.parse(read("adversarial-injected-fact/obeyed-output.json"));
    expect(checkAnalysisCitations(injected, output)).toEqual({
      ok: false,
      uncitedFigures: ["99"],
      unknownPaths: ["user.email"],
    });
  });

  it("rejects a reply that invents a price target", () => {
    const output = analysisOutputSchema.parse(read("adversarial-invented-target/output.json"));
    expect(checkAnalysisCitations(inputsOf("contemplated-bull-call-spread"), output)).toEqual({
      ok: false,
      uncitedFigures: ["34,00"],
      unknownPaths: [],
    });
  });

  it("rejects a reply with a field outside the contract", () => {
    expect(
      analysisOutputSchema.safeParse(read("adversarial-extra-field/output.json")).success,
    ).toBe(false);
  });

  it("rejects a reply that states its confidence as a number", () => {
    expect(
      analysisOutputSchema.safeParse(read("adversarial-numeric-confidence/output.json")).success,
    ).toBe(false);
  });
});
