import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { replyFromMessage } from "./filing-label-model";

function message(stopReason: Anthropic.Message["stop_reason"], text: string): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1800, output_tokens: 60 },
  } as Anthropic.Message;
}

const usage = { inputTokens: 1800, outputTokens: 60 };

describe("replyFromMessage", () => {
  it("parses the JSON a finished reply carries, with the model and usage", () => {
    const label = { topic: "dividends", tone: "positive", summary: "Proventos aprovados." };
    expect(replyFromMessage(message("end_turn", JSON.stringify(label)))).toEqual({
      kind: "parsed",
      output: label,
      model: "claude-haiku-5-5",
      usage,
    });
  });

  it("passes on text that is not JSON as nothing, for the contract to reject", () => {
    expect(replyFromMessage(message("end_turn", "Sure! Here is the label"))).toMatchObject({
      kind: "parsed",
      output: null,
    });
  });

  it("keeps a refusal and a cut-off reply apart from a parsed one", () => {
    expect(replyFromMessage(message("refusal", ""))).toEqual({
      kind: "refusal",
      model: "claude-haiku-5-5",
      usage,
    });
    expect(replyFromMessage(message("max_tokens", '{"topic":'))).toEqual({
      kind: "incomplete",
      model: "claude-haiku-5-5",
      usage,
    });
    expect(replyFromMessage(message("tool_use", ""))).toMatchObject({ kind: "incomplete" });
  });
});
