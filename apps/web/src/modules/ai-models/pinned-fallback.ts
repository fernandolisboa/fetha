import Anthropic from "@anthropic-ai/sdk";
import { pinnedModels } from "@fetha/prompts";
import type { ModelFamily } from "@fetha/contracts";

// A resolved id can go stale (a dated snapshot Anthropic later removes, a
// release withdrawn): one retry on the family's own pinned floor instead of
// failing a request for a reason the user never caused (docs/adr/0068).
// `onRejected` fires only once the pinned retry itself succeeds: a 400/404
// caused by the request's own payload (an unreadable PDF) fails the same
// way on the pinned id, and that is not evidence the first model was stale
// (#322 review).
export async function withPinnedFallback<T>(
  family: ModelFamily,
  model: string,
  attempt: (model: string) => Promise<T>,
  onRejected?: (modelId: string) => void,
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
    const result = await attempt(pinnedId);
    onRejected?.(model);
    return result;
  }
}
