import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  analysisInputsSchema,
  analysisOutputV3Schema,
  checkAnalysisCitations,
  checkAnalysisVerdict,
  resolveAnalysisOutlook,
  type AnalysisInputs,
  type AnalysisObjectKind,
  type AnalysisOutputV3,
} from "@fetha/contracts";

import { render, system } from "./v3";

const fixtures = fileURLToPath(new URL("../../fixtures/analysis/v3/", import.meta.url));

function read(path: string): unknown {
  return JSON.parse(readFileSync(`${fixtures}${path}`, "utf8"));
}

function inputsOf(name: string): AnalysisInputs & { subject: AnalysisObjectKind } {
  const inputs = analysisInputsSchema.parse(read(`${name}/inputs.json`));
  if (inputs.subject === "research") throw new Error(`${name}: not an object subject`);
  return { ...inputs, subject: inputs.subject };
}

function outputOf(name: string, file = "output.json"): AnalysisOutputV3 {
  return analysisOutputV3Schema.parse(read(`${name}/${file}`));
}

const golden = readdirSync(fixtures).filter((name) => !name.startsWith("adversarial-"));
const suggestion = inputsOf("suggestion-bull-call-spread");
const operation = inputsOf("contemplated-bull-call-spread");

describe("analysis@3 golden fixtures", () => {
  it("cover a suggestion with a verdict and another subject without one", () => {
    const subjects = golden.map((name) => [inputsOf(name).subject, outputOf(name).verdict]);
    expect(subjects).toContainEqual(["suggestion", expect.objectContaining({ decision: "enter" })]);
    expect(subjects).toContainEqual(["contemplated_operation", null]);
  });

  it.each(golden)("%s: the output meets the contract and cites only its facts", (name) => {
    expect(checkAnalysisCitations(inputsOf(name), outputOf(name))).toEqual({ ok: true });
    expect(checkAnalysisVerdict(inputsOf(name).subject, outputOf(name))).toEqual({ ok: true });
  });

  it("resolves the suggestion's outlook to its break-even at expiry", () => {
    const outlook = outputOf("suggestion-bull-call-spread").outlook;
    expect(outlook && resolveAnalysisOutlook(suggestion, outlook)).toEqual({
      ok: true,
      claim: { kind: "close_above", instrument: "PETR4", level: "32.2" },
      confidence: "0.6",
      horizon: { kind: "expiry", expiry: "2026-11-20" },
    });
  });

  it.each(golden)("%s: the rendered request carries the facts unchanged", (name) => {
    const inputs = inputsOf(name);
    const block = /<engine_facts>\n([\s\S]*)\n<\/engine_facts>$/.exec(render(inputs));
    expect(JSON.parse(block?.[1] ?? "null")).toEqual(inputs.facts);
  });

  it("names every verdict word the contract accepts", () => {
    for (const word of ["verdict", "enter", "wait", "do_not_enter", "justification"]) {
      expect(system).toContain(word);
    }
  });
});

describe("analysis@3 adversarial fixtures", () => {
  it("refuses a suggestion analysis that ends without a verdict", () => {
    const output = outputOf("adversarial-suggestion-without-verdict");
    expect(checkAnalysisCitations(suggestion, output)).toEqual({ ok: true });
    expect(checkAnalysisVerdict("suggestion", output)).toEqual({ ok: false, problem: "missing" });
  });

  it("refuses a verdict on an operation the user is studying", () => {
    const output = outputOf("adversarial-verdict-on-operation");
    expect(checkAnalysisCitations(operation, output)).toEqual({ ok: true });
    expect(checkAnalysisVerdict("contemplated_operation", output)).toEqual({
      ok: false,
      problem: "unexpected",
    });
  });

  it("refuses a verdict whose justification invents a price", () => {
    expect(
      checkAnalysisCitations(suggestion, outputOf("adversarial-verdict-invented-figure")),
    ).toEqual({ ok: false, uncitedFigures: ["33,50"], unknownPaths: [] });
  });

  it("refuses a verdict written as a number", () => {
    expect(
      analysisOutputV3Schema.safeParse(read("adversarial-numeric-verdict/output.json")).success,
    ).toBe(false);
  });

  it("keeps an injected closing tag inside the facts block and rejects a reply that obeyed it", () => {
    const injected = inputsOf("adversarial-injected-fact");
    const message = render(injected);
    expect(message.match(/<\/engine_facts>/g)).toHaveLength(1);
    expect(message.match(/<engine_facts>/g)).toHaveLength(1);
    expect(
      checkAnalysisCitations(injected, outputOf("adversarial-injected-fact", "obeyed-output.json")),
    ).toEqual({ ok: false, uncitedFigures: ["99"], unknownPaths: [] });
  });
});
