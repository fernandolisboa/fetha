import { createHash } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import { pinnedModels } from "@fetha/prompts";
import type { ModelFamily } from "@fetha/contracts";

import { newestOfFamily, type CatalogModelInfo } from "./model-resolver";

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export type ModelFetcher = (apiKey: string) => Promise<CatalogModelInfo[]>;

interface CacheEntry {
  // null means the last fetch for this key failed: resolution falls back
  // to the pinned id for the shorter failure TTL instead of caching an
  // empty listing as if it were a real one.
  models: CatalogModelInfo[] | null;
  expiresAt: number;
  // Ids a pinned-fallback retry (`withPinnedFallback`) had to rescue:
  // skipped until this same listing expires and is re-fetched, so one bad
  // resolution does not keep being handed out for up to 6h (#322 review
  // A2).
  rejectedIds: Set<string>;
}

// Never the plaintext API key, so a heap dump or an accidental log of this
// map's keys cannot leak a credential (#322 review A2).
function cacheKeyOf(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

// One cache entry per API key (the server's own, or a user's), each on its
// own TTL clock: a key that starts failing does not poison another key's
// cached listing (docs/adr/0068).
export class ModelCatalog {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CatalogModelInfo[]>>();

  constructor(
    private readonly fetchModels: ModelFetcher = defaultFetchModels,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async resolveModel(family: ModelFamily, listingKey: string | undefined): Promise<string> {
    if (!listingKey) {
      return pinnedModels[family];
    }
    const cacheKey = cacheKeyOf(listingKey);
    const models = await this.listModels(listingKey, cacheKey);
    const rejected = this.cache.get(cacheKey)?.rejectedIds;
    const usable =
      rejected && rejected.size > 0 ? models.filter((m) => !rejected.has(m.id)) : models;
    return newestOfFamily(usable, family);
  }

  // Called after a pinned-fallback retry had to rescue a resolution: the
  // rejected id is skipped by this same cached listing until it expires.
  markRejected(listingKey: string, modelId: string): void {
    this.cache.get(cacheKeyOf(listingKey))?.rejectedIds.add(modelId);
  }

  private async listModels(apiKey: string, cacheKey: string): Promise<CatalogModelInfo[]> {
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.models ?? [];
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }
    const fetchedAt = now;
    const promise = this.fetchModels(apiKey)
      .then((models) => {
        this.cache.set(cacheKey, {
          models,
          expiresAt: fetchedAt + SUCCESS_TTL_MS,
          rejectedIds: new Set(),
        });
        return models;
      })
      .catch(() => {
        this.cache.set(cacheKey, {
          models: null,
          expiresAt: fetchedAt + FAILURE_TTL_MS,
          rejectedIds: new Set(),
        });
        return [];
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, promise);
    return promise;
  }
}

async function defaultFetchModels(apiKey: string): Promise<CatalogModelInfo[]> {
  const anthropic = new Anthropic({ apiKey, timeout: FETCH_TIMEOUT_MS, maxRetries: 0 });
  const models: CatalogModelInfo[] = [];
  for await (const model of anthropic.models.list()) {
    models.push({ id: model.id, createdAt: new Date(model.created_at) });
  }
  return models;
}

// One process-wide catalog: its own cache is the point (CLAUDE.md
// pragmatism beats a DI container for a single mutable cache).
export const defaultModelCatalog = new ModelCatalog();
