import Anthropic from "@anthropic-ai/sdk";
import { pinnedModels } from "@fetha/prompts";
import type { ModelFamily } from "@fetha/contracts";

import { defaultModelCatalog, type ModelCatalog } from "./model-catalog";

// A resolved id can go stale (a dated snapshot Anthropic later removes, a
// release withdrawn): one retry on the family's own pinned floor instead of
// failing a request for a reason the user never caused (docs/adr/0068). The
// rejected id is marked so the next resolution against the same listing
// skips it rather than handing it out again until the listing's TTL expires
// (#322 review A2/A3).
export async function withPinnedFallback<T>(
  family: ModelFamily,
  model: string,
  attempt: (model: string) => Promise<T>,
  listingKey: string | undefined,
  catalog: ModelCatalog = defaultModelCatalog,
): Promise<T> {
  try {
    return await attempt(model);
  } catch (error) {
    const pinnedId = pinnedModels[family];
    const retryable =
      model !== pinnedId &&
      (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError);
    if (!retryable) {
      throw error;
    }
    if (listingKey) {
      catalog.markRejected(listingKey, model);
    }
    return attempt(pinnedId);
  }
}
