import { defaultAnalysisFamilies } from "@fetha/prompts";
import type { AiSettingsModelFamilies, AnalysisSubjectKind, ModelFamily } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { AiSettingsRepository, type OwnApiKey } from "./ai-settings-repository";
import { defaultModelCatalog } from "./model-catalog";
import { readBetterAuthSecret } from "./env";
import { readAnthropicApiKey } from "./server-key";

export type AnalysisModelResolution =
  | {
      status: "ok";
      apiKey: string;
      model: string;
      family: ModelFamily;
      // Marks `modelId` rejected on the listing it was resolved from, so a
      // later resolution skips it until that listing's TTL expires
      // (#322 review A2/A3). A closure instead of the listing key itself:
      // the key is a plaintext credential, and decisions (the one caller
      // today) has no business holding it, only calling this back.
      markRejected: (modelId: string) => void;
    }
  | { status: "own_key_missing" }
  | { status: "own_key_unreadable" };

interface AnalysisModelPolicy {
  apiKey: string;
  listingKey: string | undefined;
  family: ModelFamily;
}

type AnalysisModelPolicyResult =
  | ({ status: "ok" } & AnalysisModelPolicy)
  | { status: "own_key_missing" }
  | { status: "own_key_unreadable" };

// Listing the catalog is free and reads only catalog metadata, not a
// billed analysis, so it keeps its own, looser policy (#325): the server's
// key lists for everyone so every user's own key does not each make its
// own listing call, falling back to the user's own key only when there is
// no server key (docs/adr/0068).
export function resolveListingKey(
  serverKey: string | undefined,
  ownKey: OwnApiKey,
): string | undefined {
  return serverKey ?? (ownKey.status === "ok" ? ownKey.key : undefined);
}

// Billing policy (#325): a user-requested analysis is only ever billed to
// that user's own key, never to the server's — the server key exists to
// list the catalog and to run background jobs with no user to bill, not to
// subsidize analyses the owner didn't opt into paying for. A missing own
// key and an own key that no longer decrypts are reported as distinct
// outcomes (ADR-0068 §4, #322 review A1) rather than silently billed to the
// server key, so the user knows to save or re-save one, not find it quietly
// ignored.
export function resolveAnalysisModelPolicy(input: {
  serverKey: string | undefined;
  ownKey: OwnApiKey;
  families: AiSettingsModelFamilies;
  kind: AnalysisSubjectKind;
}): AnalysisModelPolicyResult {
  const { serverKey, ownKey, families, kind } = input;
  if (ownKey.status === "unreadable") {
    return { status: "own_key_unreadable" };
  }
  if (ownKey.status !== "ok") {
    return { status: "own_key_missing" };
  }
  const listingKey = resolveListingKey(serverKey, ownKey);
  const family = families[kind] ?? defaultAnalysisFamilies[kind];
  return { status: "ok", apiKey: ownKey.key, listingKey, family };
}

// The one entry point every caller that bills an analysis to a model must
// go through (#322 review B2): reads the current user's own key and model
// family choices, applies the billing policy above, then resolves the
// family to a concrete model id through the shared catalog.
export async function resolveAnalysisModelForCurrentUser(
  kind: AnalysisSubjectKind,
): Promise<AnalysisModelResolution> {
  const serverKey = readAnthropicApiKey();
  const secret = readBetterAuthSecret();
  const repository = await forCurrentUser(getDb(), AiSettingsRepository);
  const [ownKey, families] = await Promise.all([
    repository.readOwnApiKey(secret),
    repository.getModelFamilies(),
  ]);
  const policy = resolveAnalysisModelPolicy({ serverKey, ownKey, families, kind });
  if (policy.status !== "ok") {
    return policy;
  }
  const model = await defaultModelCatalog.resolveModel(policy.family, policy.listingKey);
  const listingKey = policy.listingKey;
  return {
    status: "ok",
    apiKey: policy.apiKey,
    model,
    family: policy.family,
    markRejected: (modelId: string) => {
      if (listingKey) {
        defaultModelCatalog.markRejected(listingKey, modelId);
      }
    },
  };
}
