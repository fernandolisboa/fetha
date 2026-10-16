import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultModelCatalog } from "@/modules/ai-models";

import { createAnthropicFilingLabelClient } from "./filing-label-model";

const PDF = new Uint8Array([1, 2, 3]);
const INPUTS = {
  companyName: "Empresa X",
  category: "material_fact",
  kind: "Fato Relevante",
  subject: "Dividendos",
  deliveredOn: "17/10/2026",
} as const;

function fakeMessage(model: string, text: string): Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  } as unknown as Message;
}

function badRequest() {
  return new Anthropic.BadRequestError(400, {}, "bad request", new Headers());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAnthropicFilingLabelClient retry on 400/404", () => {
  it("resolves the newest haiku and retries on the pinned id on a 400", async () => {
    vi.spyOn(defaultModelCatalog, "resolveModel").mockResolvedValue("claude-haiku-6");
    const create = vi
      .spyOn(Anthropic.Messages.prototype, "create")
      .mockRejectedValueOnce(badRequest())
      .mockResolvedValueOnce(
        fakeMessage("claude-haiku-5-5", '{"topic":"dividends","tone":"positive","summary":"ok"}'),
      );

    const client = createAnthropicFilingLabelClient("sk-ant-fake");
    const reply = await client.label({ pdf: PDF, inputs: INPUTS });

    expect(reply).toMatchObject({ kind: "parsed", model: "claude-haiku-5-5" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: "claude-haiku-6" });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ model: "claude-haiku-5-5" });
  });

  it("ends bad_request after the pinned retry when the document itself is unreadable", async () => {
    vi.spyOn(defaultModelCatalog, "resolveModel").mockResolvedValue("claude-haiku-6");
    const create = vi
      .spyOn(Anthropic.Messages.prototype, "create")
      .mockRejectedValueOnce(badRequest())
      .mockRejectedValueOnce(badRequest());

    const client = createAnthropicFilingLabelClient("sk-ant-fake");
    const reply = await client.label({ pdf: PDF, inputs: INPUTS });

    expect(reply).toEqual({ kind: "bad_request" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the resolved model is already the pinned one", async () => {
    vi.spyOn(defaultModelCatalog, "resolveModel").mockResolvedValue("claude-haiku-5-5");
    const create = vi
      .spyOn(Anthropic.Messages.prototype, "create")
      .mockRejectedValueOnce(badRequest());

    const client = createAnthropicFilingLabelClient("sk-ant-fake");
    const reply = await client.label({ pdf: PDF, inputs: INPUTS });

    expect(reply).toEqual({ kind: "bad_request" });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
