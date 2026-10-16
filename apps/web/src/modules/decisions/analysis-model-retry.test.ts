import Anthropic from "@anthropic-ai/sdk";
import { Messages } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAnthropicAnalysisClient } from "./analysis-model";

function fakeMessage(model: string): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    stop_reason: "end_turn",
    content: [{ type: "text", text: '{"thesis":"a"}' }],
    usage: { input_tokens: 10, output_tokens: 20 },
  } as unknown as BetaMessage;
}

function badRequest() {
  return new Anthropic.BadRequestError(400, {}, "bad request", new Headers());
}

function notFound() {
  return new Anthropic.NotFoundError(404, {}, "not found", new Headers());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAnthropicAnalysisClient retry on 400/404", () => {
  it("retries once with the family's pinned id on a 400 for a non-pinned model", async () => {
    const create = vi
      .spyOn(Messages.prototype, "create")
      .mockRejectedValueOnce(badRequest())
      .mockResolvedValueOnce(fakeMessage("claude-opus-5-5"));

    const client = createAnthropicAnalysisClient("sk-ant-fake");
    const reply = await client.analyze({
      model: "claude-opus-6",
      family: "opus",
      system: "sys",
      user: "usr",
    });

    expect(reply).toMatchObject({ kind: "parsed", model: "claude-opus-5-5" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: "claude-opus-6" });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ model: "claude-opus-5-5" });
  });

  it("retries once with the pinned id on a 404", async () => {
    const create = vi
      .spyOn(Messages.prototype, "create")
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce(fakeMessage("claude-sonnet-5-5"));

    const client = createAnthropicAnalysisClient("sk-ant-fake");
    const reply = await client.analyze({
      model: "claude-sonnet-6",
      family: "sonnet",
      system: "sys",
      user: "usr",
    });

    expect(reply).toMatchObject({ kind: "parsed", model: "claude-sonnet-5-5" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the model was already the pinned id", async () => {
    const create = vi.spyOn(Messages.prototype, "create").mockRejectedValueOnce(badRequest());

    const client = createAnthropicAnalysisClient("sk-ant-fake");
    const reply = await client.analyze({
      model: "claude-opus-5-5",
      family: "opus",
      system: "sys",
      user: "usr",
    });

    expect(reply).toEqual({ kind: "api_error", status: 400 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-400/404 API error", async () => {
    const create = vi
      .spyOn(Messages.prototype, "create")
      .mockRejectedValueOnce(new Anthropic.InternalServerError(500, {}, "oops", new Headers()));

    const client = createAnthropicAnalysisClient("sk-ant-fake");
    const reply = await client.analyze({
      model: "claude-opus-6",
      family: "opus",
      system: "sys",
      user: "usr",
    });

    expect(reply).toEqual({ kind: "api_error", status: 500 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("answers api_error when the retry itself fails", async () => {
    const create = vi
      .spyOn(Messages.prototype, "create")
      .mockRejectedValueOnce(badRequest())
      .mockRejectedValueOnce(new Anthropic.InternalServerError(500, {}, "oops", new Headers()));

    const client = createAnthropicAnalysisClient("sk-ant-fake");
    const reply = await client.analyze({
      model: "claude-opus-6",
      family: "opus",
      system: "sys",
      user: "usr",
    });

    expect(reply).toEqual({ kind: "api_error", status: 500 });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("createAnthropicAnalysisClient fallbacks by family", () => {
  it("sends the server-side fallback beta for sonnet and opus", async () => {
    const create = vi
      .spyOn(Messages.prototype, "create")
      .mockResolvedValue(fakeMessage("claude-opus-5-5"));

    await createAnthropicAnalysisClient("sk-ant-fake").analyze({
      model: "claude-opus-5-5",
      family: "opus",
      system: "sys",
      user: "usr",
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  });

  it("omits the fallback beta for haiku (no server-side fallback exists for it)", async () => {
    const create = vi
      .spyOn(Messages.prototype, "create")
      .mockResolvedValue(fakeMessage("claude-haiku-5-5"));

    await createAnthropicAnalysisClient("sk-ant-fake").analyze({
      model: "claude-haiku-5-5",
      family: "haiku",
      system: "sys",
      user: "usr",
    });

    const params = create.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(params.betas).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
  });
});
