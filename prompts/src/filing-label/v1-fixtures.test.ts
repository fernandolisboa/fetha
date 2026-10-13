import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  checkFilingLabel,
  filingLabelInputsSchema,
  filingTones,
  filingTopics,
  type FilingLabelInputs,
} from "@fetha/contracts";

import { render, system } from "./v1";

const fixtures = fileURLToPath(new URL("../../fixtures/filing-label/v1/", import.meta.url));

function read(path: string): unknown {
  return JSON.parse(readFileSync(`${fixtures}${path}`, "utf8"));
}

function inputsOf(name: string): FilingLabelInputs {
  return filingLabelInputsSchema.parse(read(`${name}/inputs.json`));
}

const names = readdirSync(fixtures);
const golden = names.filter((name) => !name.startsWith("adversarial-"));
const labelled = [...golden, "adversarial-injection"];
const adversarialOutputs = names.filter(
  (name) => name.startsWith("adversarial-") && name !== "adversarial-injection",
);

describe("filing-label@1 golden fixtures", () => {
  it("cover every tone", () => {
    const tones = labelled.map((name) => (read(`${name}/output.json`) as { tone: string }).tone);
    expect(new Set(tones)).toEqual(new Set(filingTones));
  });

  it.each(labelled)("%s: the output meets the contract", (name) => {
    expect(checkFilingLabel(read(`${name}/output.json`))).toMatchObject({ ok: true });
  });

  it.each(labelled)("%s: the rendered request carries the metadata unchanged", (name) => {
    const inputs = inputsOf(name);
    const block = /<filing_metadata>\n([\s\S]*)\n<\/filing_metadata>$/.exec(render(inputs));
    expect(JSON.parse(block?.[1] ?? "null")).toEqual(inputs);
  });
});

describe("filing-label@1 adversarial fixtures", () => {
  it("rejects the reply that obeys the instruction planted in the document", () => {
    expect(checkFilingLabel(read("adversarial-injection/obeyed-output.json"))).toEqual({
      ok: false,
      problem: "schema",
    });
  });

  it("rejects the obeyed reply's figure even without its extra field", () => {
    const obeyed = read("adversarial-injection/obeyed-output.json") as Record<string, unknown>;
    const withoutExtra = { topic: obeyed.topic, tone: obeyed.tone, summary: obeyed.summary };
    expect(checkFilingLabel(withoutExtra)).toEqual({ ok: false, problem: "figure" });
  });

  it("keeps a tag planted in the metadata from closing the metadata block", () => {
    const rendered = render(inputsOf("adversarial-injection"));
    expect(rendered.match(/<\/filing_metadata>/g)).toHaveLength(1);
    expect(rendered.indexOf("<filing_metadata>")).toBe(rendered.lastIndexOf("<filing_metadata>"));
  });

  it.each(adversarialOutputs)("%s: the reply is rejected", (name) => {
    expect(checkFilingLabel(read(`${name}/output.json`))).toMatchObject({ ok: false });
  });
});

describe("filing-label@1 prompt", () => {
  it("names every topic and tone the contract accepts", () => {
    for (const word of [...filingTopics, ...filingTones]) {
      expect(system).toContain(word);
    }
  });
});
