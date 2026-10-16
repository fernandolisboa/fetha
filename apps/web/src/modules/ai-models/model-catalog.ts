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
}

// One cache entry per API key (the server's own, or a user's), each on its
// own TTL clock: a key that starts failing does not poison another key's
// cached listing (docs/adr/0068).
export class ModelCatalog {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetchModels: ModelFetcher = defaultFetchModels,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async resolveModel(family: ModelFamily, listingKey: string | undefined): Promise<string> {
    if (!listingKey) {
      return pinnedModels[family];
    }
    const models = await this.listModels(listingKey);
    return newestOfFamily(models, family);
  }

  private async listModels(apiKey: string): Promise<CatalogModelInfo[]> {
    const now = this.now();
    const cached = this.cache.get(apiKey);
    if (cached && cached.expiresAt > now) {
      return cached.models ?? [];
    }
    try {
      const models = await this.fetchModels(apiKey);
      this.cache.set(apiKey, { models, expiresAt: now + SUCCESS_TTL_MS });
      return models;
    } catch {
      this.cache.set(apiKey, { models: null, expiresAt: now + FAILURE_TTL_MS });
      return [];
    }
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
