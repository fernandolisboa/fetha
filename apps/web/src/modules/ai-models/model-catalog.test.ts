import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ModelCatalog } from "./model-catalog";

function at(id: string, createdAt: string) {
  return { id, createdAt: new Date(createdAt) };
}

describe("ModelCatalog", () => {
  it("answers pinned when no listing key is given, without ever fetching", async () => {
    const fetchModels = vi.fn();
    const catalog = new ModelCatalog(fetchModels);
    expect(await catalog.resolveModel("opus", undefined)).toBe("claude-opus-5-5");
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("resolves through a fetched listing", async () => {
    const fetchModels = vi.fn().mockResolvedValue([at("claude-opus-6", "2026-11-01")]);
    const catalog = new ModelCatalog(fetchModels);
    expect(await catalog.resolveModel("opus", "sk-ant-key")).toBe("claude-opus-6");
  });

  it("caches a successful listing for the success TTL", async () => {
    const fetchModels = vi.fn().mockResolvedValue([at("claude-opus-6", "2026-11-01")]);
    let now = 0;
    const catalog = new ModelCatalog(fetchModels, () => now);

    await catalog.resolveModel("opus", "sk-ant-key");
    now += 5 * 60 * 60 * 1000;
    await catalog.resolveModel("opus", "sk-ant-key");
    expect(fetchModels).toHaveBeenCalledTimes(1);

    now += 2 * 60 * 60 * 1000;
    await catalog.resolveModel("opus", "sk-ant-key");
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it("falls back to pinned and retries sooner after a failed fetch", async () => {
    const fetchModels = vi.fn().mockRejectedValue(new Error("network"));
    let now = 0;
    const catalog = new ModelCatalog(fetchModels, () => now);

    expect(await catalog.resolveModel("opus", "sk-ant-key")).toBe("claude-opus-5-5");

    now += 5 * 60 * 1000;
    await catalog.resolveModel("opus", "sk-ant-key");
    expect(fetchModels).toHaveBeenCalledTimes(1);

    now += 6 * 60 * 1000;
    await catalog.resolveModel("opus", "sk-ant-key");
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it("keeps one cache entry per key", async () => {
    const fetchModels = vi
      .fn()
      .mockResolvedValueOnce([at("claude-opus-6", "2026-11-01")])
      .mockResolvedValueOnce([]);
    const catalog = new ModelCatalog(fetchModels);
    expect(await catalog.resolveModel("opus", "key-a")).toBe("claude-opus-6");
    expect(await catalog.resolveModel("opus", "key-b")).toBe("claude-opus-5-5");
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it("never keys its cache by the plaintext API key", async () => {
    const apiKey = "sk-ant-super-secret-key";
    const fetchModels = vi.fn().mockResolvedValue([at("claude-opus-6", "2026-11-01")]);
    const catalog = new ModelCatalog(fetchModels);
    await catalog.resolveModel("opus", apiKey);

    const cache = (catalog as unknown as { cache: Map<string, unknown> }).cache;
    const keys = [...cache.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(apiKey);
    expect(keys[0]).not.toContain(apiKey);
    expect(keys[0]).toBe(createHash("sha256").update(apiKey).digest("hex"));
  });

  it("dedupes concurrent resolutions for the same key into one fetch", async () => {
    let resolveFetch: (models: ReturnType<typeof at>[]) => void = () => undefined;
    const fetchModels = vi.fn().mockReturnValue(
      new Promise<ReturnType<typeof at>[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const catalog = new ModelCatalog(fetchModels);

    const first = catalog.resolveModel("opus", "sk-ant-key");
    const second = catalog.resolveModel("opus", "sk-ant-key");
    resolveFetch([at("claude-opus-6", "2026-11-01")]);

    expect(await first).toBe("claude-opus-6");
    expect(await second).toBe("claude-opus-6");
    expect(fetchModels).toHaveBeenCalledTimes(1);
  });

  it("skips a model markRejected named, until the listing is refetched", async () => {
    const fetchModels = vi
      .fn()
      .mockResolvedValue([at("claude-opus-6", "2026-11-01"), at("claude-opus-5-6", "2026-09-01")]);
    let now = 0;
    const catalog = new ModelCatalog(fetchModels, () => now);

    expect(await catalog.resolveModel("opus", "sk-ant-key")).toBe("claude-opus-6");
    catalog.markRejected("sk-ant-key", "claude-opus-6");
    expect(await catalog.resolveModel("opus", "sk-ant-key")).toBe("claude-opus-5-6");
    expect(fetchModels).toHaveBeenCalledTimes(1);

    now += 7 * 60 * 60 * 1000;
    expect(await catalog.resolveModel("opus", "sk-ant-key")).toBe("claude-opus-6");
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });
});
