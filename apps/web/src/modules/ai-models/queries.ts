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
  return { modelFamilies, apiKey, resolvedModels };
});

// Whether this signed-in user can request an analysis at all (#325): only
// their own stored key, if one still decrypts. The server key never bills
// a user-requested analysis (docs/adr/0068's 2026-10-16 amendment), so it
// plays no part in this check regardless of whether it is configured.
export async function isAnalysisAvailable(): Promise<boolean> {
  const repository = await forCurrentUser(getDb(), AiSettingsRepository);
  const status = await repository.getApiKeyStatus(readBetterAuthSecret());
  return status.configured && status.readable;
}
