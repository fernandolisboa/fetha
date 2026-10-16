import { defaultAnalysisFamilies } from "@fetha/prompts";
import type { AiSettingsModelFamilies, AnalysisSubjectKind, ModelFamily } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { AiSettingsRepository, type OwnApiKey } from "./ai-settings-repository";
import { defaultModelCatalog } from "./model-catalog";
import { readBetterAuthSecret } from "./env";
import { readAnthropicApiKey } from "./server-key";

export type AnalysisModelResolution =
  | { status: "ok"; apiKey: string; model: string; family: ModelFamily }
  | { status: "unavailable" }
  | { status: "own_key_unreadable" };

interface AnalysisModelPolicy {
  apiKey: string;
  listingKey: string | undefined;
  family: ModelFamily;
}

type AnalysisModelPolicyResult =
  | ({ status: "ok" } & AnalysisModelPolicy)
  | { status: "unavailable" }
  | { status: "own_key_unreadable" };

// The server's own key always lists the catalog, so every user's own key
// does not each make its own listing call; it also bills whenever the
// user has no key of their own (docs/adr/0068).
export function resolveListingKey(
  serverKey: string | undefined,
  ownKey: OwnApiKey,
): string | undefined {
  return serverKey ?? (ownKey.status === "ok" ? ownKey.key : undefined);
}

// Billing policy: a stored key that still decrypts is always preferred,
// even when the server has its own key; a stored key that no longer
// decrypts is reported as its own distinct outcome rather than silently
// billed to the server key (ADR-0068 §4, #322 review A1) — the user needs
// to know to re-save or remove it, not have their own key quietly ignored.
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
  const apiKey = ownKey.status === "ok" ? ownKey.key : serverKey;
  if (!apiKey) {
    return { status: "unavailable" };
  }
  const listingKey = resolveListingKey(serverKey, ownKey);
  const family = families[kind] ?? defaultAnalysisFamilies[kind];
  return { status: "ok", apiKey, listingKey, family };
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
  return { status: "ok", apiKey: policy.apiKey, model, family: policy.family };
}
