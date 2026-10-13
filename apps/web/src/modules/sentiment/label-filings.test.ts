import { describe, expect, it } from "vitest";

import { labelWindowStart, resultOfReply } from "./label-filings";

const usage = { inputTokens: 2000, outputTokens: 50 };
const call = {
  model: "claude-haiku-5-5",
  promptVersion: "filing-label@1",
  inputTokens: 2000,
  outputTokens: 50,
};

describe("labelWindowStart", () => {
  it("looks back ninety days", () => {
    expect(labelWindowStart(new Date("2026-10-13T03:00:00Z"))).toBe("2026-07-15");
  });
});

describe("resultOfReply", () => {
  it("stores a reply that meets the contract as a label", () => {
    const output = {
      topic: "debt",
      tone: "neutral",
      summary: "A companhia concluiu a emissão de debêntures.",
    };
    expect(resultOfReply({ kind: "parsed", output, model: "claude-haiku-5-5", usage })).toEqual({
      kind: "final",
      label: { outcome: "labelled", ...output },
      call,
    });
  });

  it("stores a reply that breaks the contract as rejected, with its reason", () => {
    expect(
      resultOfReply({
        kind: "parsed",
        output: { topic: "debt", tone: "neutral", summary: "Emissão de R$ 1 bilhão." },
        model: "claude-haiku-5-5",
        usage,
      }),
    ).toEqual({ kind: "final", label: { outcome: "rejected", reason: "figure" }, call });
    expect(
      resultOfReply({ kind: "parsed", output: null, model: "claude-haiku-5-5", usage }),
    ).toEqual({ kind: "final", label: { outcome: "rejected", reason: "schema" }, call });
  });

  it("stores refusals, cut-off replies and refused requests as final rejections", () => {
    expect(resultOfReply({ kind: "refusal", model: "claude-haiku-5-5", usage })).toEqual({
      kind: "final",
      label: { outcome: "rejected", reason: "refusal" },
      call,
    });
    expect(resultOfReply({ kind: "incomplete", model: "claude-haiku-5-5", usage })).toEqual({
      kind: "final",
      label: { outcome: "rejected", reason: "incomplete" },
      call,
    });
    expect(resultOfReply({ kind: "bad_request" })).toEqual({
      kind: "final",
      label: { outcome: "rejected", reason: "bad_request" },
      call: null,
    });
  });

  it("leaves an API outage for the next run", () => {
    expect(resultOfReply({ kind: "api_error" })).toEqual({ kind: "api_error" });
  });
});
