import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { ModelCatalog } from "./model-catalog";
import { withPinnedFallback } from "./pinned-fallback";

function badRequest() {
  return new Anthropic.BadRequestError(400, {}, "bad request", new Headers());
}

describe("withPinnedFallback", () => {
  it("retries once on the pinned id and marks the rejected id on the listing's catalog", async () => {
    const catalog = new ModelCatalog(vi.fn());
    const markRejected = vi.spyOn(catalog, "markRejected");
    const attempt = vi.fn().mockRejectedValueOnce(badRequest()).mockResolvedValueOnce("ok");

    const result = await withPinnedFallback(
      "opus",
      "claude-opus-6",
      attempt,
      "sk-ant-key",
      catalog,
    );

    expect(result).toBe("ok");
    expect(attempt).toHaveBeenNthCalledWith(1, "claude-opus-6");
    expect(attempt).toHaveBeenNthCalledWith(2, "claude-opus-5-5");
    expect(markRejected).toHaveBeenCalledWith("sk-ant-key", "claude-opus-6");
  });

  it("does not retry or mark anything when the model was already the pinned id", async () => {
    const catalog = new ModelCatalog(vi.fn());
    const markRejected = vi.spyOn(catalog, "markRejected");
    const attempt = vi.fn().mockRejectedValueOnce(badRequest());

    await expect(
      withPinnedFallback("opus", "claude-opus-5-5", attempt, "sk-ant-key", catalog),
    ).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(markRejected).not.toHaveBeenCalled();
  });

  it("does not retry a non-400/404 error", async () => {
    const catalog = new ModelCatalog(vi.fn());
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Anthropic.InternalServerError(500, {}, "oops", new Headers()));

    await expect(
      withPinnedFallback("opus", "claude-opus-6", attempt, "sk-ant-key", catalog),
    ).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("does not mark anything when there is no listing key (the model was the pinned fallback already)", async () => {
    const catalog = new ModelCatalog(vi.fn());
    const markRejected = vi.spyOn(catalog, "markRejected");
    const attempt = vi.fn().mockRejectedValueOnce(badRequest()).mockResolvedValueOnce("ok");

    const result = await withPinnedFallback("opus", "claude-opus-6", attempt, undefined, catalog);

    expect(result).toBe("ok");
    expect(markRejected).not.toHaveBeenCalled();
  });
});
