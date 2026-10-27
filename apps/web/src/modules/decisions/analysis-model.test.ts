import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { analysisOutputSchema, researchOutputSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { replyFromMessage } from "./analysis-model";

function message(
  stopReason: string,
  content: ReadonlyArray<{ type: string; text?: string }>,
): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: stopReason,
    content,
    usage: { input_tokens: 1200, output_tokens: 300 },
  } as unknown as BetaMessage;
}

describe("betaZodOutputFormat(analysisOutputSchema)", () => {
  it("builds without throwing", () => {
    expect(() => betaZodOutputFormat(analysisOutputSchema)).not.toThrow();
  });
});

describe("betaZodOutputFormat(researchOutputSchema)", () => {
  it("builds without throwing and asks for one verdict per idea from the closed lists", () => {
    const format = betaZodOutputFormat(researchOutputSchema);
    const schema = JSON.stringify(format.schema);
    expect(schema).toContain("do_not_enter");
    expect(schema).toContain("trend_against");
  });
});

describe("replyFromMessage", () => {
  it("reads a refusal as a refusal, whatever text came with it", () => {
    expect(replyFromMessage(message("refusal", [{ type: "text", text: "{}" }]))).toEqual({
      kind: "refusal",
      model: "claude-opus-5-5",
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
  });

  it("reads a truncated reply as incomplete with its stop reason", () => {
    expect(replyFromMessage(message("max_tokens", [{ type: "text", text: '{"thesis":' }]))).toEqual(
      {
        kind: "incomplete",
        stopReason: "max_tokens",
        model: "claude-opus-5-5",
        usage: { inputTokens: 1200, outputTokens: 300 },
      },
    );
  });

  it.each(["pause_turn", "model_context_window_exceeded", "tool_use", "compaction"])(
    "reads stop reason %s as incomplete",
    (stopReason) => {
      expect(replyFromMessage(message(stopReason, [{ type: "text", text: "{}" }]))).toEqual({
        kind: "incomplete",
        stopReason,
        model: "claude-opus-5-5",
        usage: { inputTokens: 1200, outputTokens: 300 },
      });
    },
  );

  it("reads a stop_sequence stop reason as a parsed reply", () => {
    expect(
      replyFromMessage(message("stop_sequence", [{ type: "text", text: '{"thesis":"a"}' }])),
    ).toEqual({
      kind: "parsed",
      output: { thesis: "a" },
      model: "claude-opus-5-5",
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
  });

  it("parses the JSON text with the serving model and its usage", () => {
    expect(
      replyFromMessage(
        message("end_turn", [
          { type: "text", text: '{"thesis":' },
          { type: "text", text: '"a"}' },
        ]),
      ),
    ).toEqual({
      kind: "parsed",
      output: { thesis: "a" },
      model: "claude-opus-5-5",
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
  });

  it("keeps a reply that is not JSON as a null output for the contract to reject", () => {
    expect(
      replyFromMessage(message("end_turn", [{ type: "text", text: "Não posso." }])),
    ).toMatchObject({ kind: "parsed", output: null });
  });

  it("reads only the text after the last fallback block", () => {
    expect(
      replyFromMessage(
        message("end_turn", [
          { type: "text", text: '{"partial":' },
          { type: "fallback" },
          { type: "text", text: '{"thesis":"b"}' },
        ]),
      ),
    ).toMatchObject({ kind: "parsed", output: { thesis: "b" } });
  });
});
