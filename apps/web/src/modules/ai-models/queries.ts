import { cache } from "react";
import { defaultAnalysisFamilies } from "@fetha/prompts";
import {
  analysisSubjectKinds,
  type AiSettingsModelFamilies,
  type AnalysisSubjectKind,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { AiSettingsRepository, type ApiKeyStatus } from "./ai-settings-repository";
import { defaultModelCatalog } from "./model-catalog";
import { readAnthropicApiKey } from "./server-key";
import { readBetterAuthSecret } from "./env";

export interface AiSettingsView {
  modelFamilies: AiSettingsModelFamilies;
  apiKey: ApiKeyStatus;
  serverKeyConfigured: boolean;
  resolvedModels: Record<AnalysisSubjectKind, string>;
}

// The page's own read: `apiKey` never carries more than
// `{ configured, last4, updatedAt, readable }` (docs/adr/0068) — the
// ciphertext itself has no query that returns it to a page.
export const getMyAiSettings = cache(async (): Promise<AiSettingsView> => {
  const repository = await forCurrentUser(getDb(), AiSettingsRepository);
  const secret = readBetterAuthSecret();
  const serverKey = readAnthropicApiKey();
  const [modelFamilies, apiKey, own] = await Promise.all([
    repository.getModelFamilies(),
    repository.getApiKeyStatus(secret),
    repository.readOwnApiKey(secret),
  ]);
  const listingKey = serverKey ?? (own.status === "ok" ? own.key : undefined);
  const resolvedModels = Object.fromEntries(
    await Promise.all(
      analysisSubjectKinds.map(async (kind) => {
        const family = modelFamilies[kind] ?? defaultAnalysisFamilies[kind];
        return [kind, await defaultModelCatalog.resolveModel(family, listingKey)] as const;
      }),
    ),
  ) as Record<AnalysisSubjectKind, string>;
  return { modelFamilies, apiKey, serverKeyConfigured: serverKey !== undefined, resolvedModels };
});

// Whether this signed-in user can request an analysis at all: the server
// key, or their own key if one is stored and still decrypts
// (docs/adr/0068). Replaces the old environment-only check.
export async function isAnalysisAvailable(): Promise<boolean> {
  if (readAnthropicApiKey() !== undefined) {
    return true;
  }
  const repository = await forCurrentUser(getDb(), AiSettingsRepository);
  const status = await repository.getApiKeyStatus(readBetterAuthSecret());
  return status.configured && status.readable;
}
