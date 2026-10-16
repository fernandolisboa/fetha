import { cache } from "react";
import { defaultAnalysisFamilies } from "@fetha/prompts";
import {
  analysisSubjectKinds,
  type AiSettingsModelFamilies,
  type AnalysisSubjectKind,
  type ModelFamily,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { AiSettingsRepository, type ApiKeyStatus, type OwnApiKey } from "./ai-settings-repository";
import { defaultModelCatalog } from "./model-catalog";
import { resolveListingKey } from "./resolve-analysis-model";
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
// ciphertext itself has no query that returns it to a page. It decrypts the
// stored key only when there is no server key to list with (#322 review A5).
export const getMyAiSettings = cache(async (): Promise<AiSettingsView> => {
  const repository = await forCurrentUser(getDb(), AiSettingsRepository);
  const secret = readBetterAuthSecret();
  const serverKey = readAnthropicApiKey();
  const [modelFamilies, apiKey, own] = await Promise.all([
    repository.getModelFamilies(),
    repository.getApiKeyStatus(secret),
    serverKey === undefined
      ? repository.readOwnApiKey(secret)
      : Promise.resolve<OwnApiKey>({ status: "none" }),
  ]);
  const listingKey = resolveListingKey(serverKey, own);
  const familyOf = (kind: AnalysisSubjectKind): ModelFamily =>
    modelFamilies[kind] ?? defaultAnalysisFamilies[kind];
  const distinctFamilies = [...new Set(analysisSubjectKinds.map(familyOf))];
  const modelByFamily = new Map<ModelFamily, string>(
    await Promise.all(
      distinctFamilies.map(
        async (family) =>
          [family, await defaultModelCatalog.resolveModel(family, listingKey)] as const,
      ),
    ),
  );
  const resolvedModels = Object.fromEntries(
    analysisSubjectKinds.map((kind) => [kind, modelByFamily.get(familyOf(kind))]),
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
