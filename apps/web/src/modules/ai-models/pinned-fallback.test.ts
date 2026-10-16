import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { withPinnedFallback } from "./pinned-fallback";

function badRequest() {
  return new Anthropic.BadRequestError(400, {}, "bad request", new Headers());
}

describe("withPinnedFallback", () => {
  it("retries once on the pinned id and calls onRejected only once that retry succeeds", async () => {
    const onRejected = vi.fn();
    const attempt = vi.fn().mockRejectedValueOnce(badRequest()).mockResolvedValueOnce("ok");

    const result = await withPinnedFallback("opus", "claude-opus-6", attempt, onRejected);

    expect(result).toBe("ok");
    expect(attempt).toHaveBeenNthCalledWith(1, "claude-opus-6");
    expect(attempt).toHaveBeenNthCalledWith(2, "claude-opus-5-5");
    expect(onRejected).toHaveBeenCalledWith("claude-opus-6");
  });

  it("does not call onRejected when the pinned retry also fails (the payload, not the model, is at fault)", async () => {
    const onRejected = vi.fn();
    const attempt = vi.fn().mockRejectedValueOnce(badRequest()).mockRejectedValueOnce(badRequest());

    await expect(
      withPinnedFallback("opus", "claude-opus-6", attempt, onRejected),
    ).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("does not retry or call onRejected when the model was already the pinned id", async () => {
    const onRejected = vi.fn();
    const attempt = vi.fn().mockRejectedValueOnce(badRequest());

    await expect(
      withPinnedFallback("opus", "claude-opus-5-5", attempt, onRejected),
    ).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("does not retry a non-400/404 error", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Anthropic.InternalServerError(500, {}, "oops", new Headers()));

    await expect(withPinnedFallback("opus", "claude-opus-6", attempt)).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("works without an onRejected callback", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(badRequest()).mockResolvedValueOnce("ok");

    const result = await withPinnedFallback("opus", "claude-opus-6", attempt);

    expect(result).toBe("ok");
  });
});
