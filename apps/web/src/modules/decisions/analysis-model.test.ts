import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { analysisOutputSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { readAnthropicApiKey, replyFromMessage } from "./analysis-model";

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

describe("readAnthropicApiKey", () => {
  it("returns undefined when the key is missing", () => {
    expect(readAnthropicApiKey({})).toBeUndefined();
  });

  it("returns undefined when the key is an empty string", () => {
    expect(readAnthropicApiKey({ ANTHROPIC_API_KEY: "" })).toBeUndefined();
  });

  it("returns the key when present", () => {
    expect(readAnthropicApiKey({ ANTHROPIC_API_KEY: "sk-test" })).toBe("sk-test");
  });
});

describe("betaZodOutputFormat(analysisOutputSchema)", () => {
  it("builds without throwing", () => {
    expect(() => betaZodOutputFormat(analysisOutputSchema)).not.toThrow();
  });
});

describe("replyFromMessage", () => {
  it("reads a refusal as a refusal, whatever text came with it", () => {
    expect(replyFromMessage(message("refusal", [{ type: "text", text: "{}" }]))).toEqual({
      kind: "refusal",
    });
  });

  it("reads a truncated reply as max_tokens", () => {
    expect(replyFromMessage(message("max_tokens", [{ type: "text", text: '{"thesis":' }]))).toEqual(
      { kind: "max_tokens" },
    );
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
