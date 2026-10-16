"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { analysisSubjectKinds } from "@fetha/contracts";

import { defaultAnalysisFamilies } from "@fetha/prompts";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import {
  AiSettingsRepository,
  defaultModelCatalog,
  readAnthropicApiKey,
  readBetterAuthSecret,
} from "@/modules/ai-models";

import { createAnthropicAnalysisClient } from "./analysis-model";
import { requestAnalysis, type AcceptedAnalysisView } from "./analysis-service";

const requestInputSchema = z.strictObject({
  subjectKind: z.enum(analysisSubjectKinds),
  subjectId: z.string().min(1).max(200),
});

export type RequestAnalysisActionInput = z.infer<typeof requestInputSchema>;

export type RequestAnalysisActionResult =
  | { status: "ok"; analysis: AcceptedAnalysisView }
  | {
      status: "error";
      error:
        | "invalid"
        | "not_found"
        | "not_ready"
        | "unavailable"
        | "cap_reached"
        | "rate_limited"
        | "rejected"
        | "failed";
    };

// A paid call for every analysis, any account (docs/adr/0057): this window
// is tighter than `decisions/record`'s own (`actions.ts`), the same shape
// backtests and operations use for their own per-minute floors.
const REQUEST_RATE_LIMIT = { windowSeconds: 60, max: 3 };

export async function requestAnalysisAction(
  input: RequestAnalysisActionInput,
): Promise<RequestAnalysisActionResult> {
  const parsed = requestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    const result = await withAuthenticatedAction(async () => {
      const user = await requireUser();
      await enforceAccountRateLimit(getDb(), user.email, "analyses/request", REQUEST_RATE_LIMIT);

      const serverKey = readAnthropicApiKey();
      const settings = await forCurrentUser(getDb(), AiSettingsRepository);
      const secret = readBetterAuthSecret();
      const ownKey = await settings.readOwnApiKey(secret);
      // Billing prefers the user's own key when it is present and still
      // readable; listing the model catalog prefers the server's own key
      // so every user's own key does not each make its own listing call
      // (docs/adr/0068).
      const analysisKey = ownKey.status === "ok" ? ownKey.key : serverKey;
      if (!analysisKey) {
        return { status: "unavailable" as const };
      }
      const listingKey = serverKey ?? (ownKey.status === "ok" ? ownKey.key : undefined);
      const families = await settings.getModelFamilies();
      const family =
        families[parsed.data.subjectKind] ?? defaultAnalysisFamilies[parsed.data.subjectKind];
      const model = await defaultModelCatalog.resolveModel(family, listingKey);
      const client = createAnthropicAnalysisClient(analysisKey);

      return requestAnalysis(
        { db: getDb(), user, client, model, family },
        { subjectKind: parsed.data.subjectKind, subjectId: parsed.data.subjectId },
      );
    });

    if (result.status === "accepted") {
      revalidatePath("/sinais");
      revalidatePath("/carteira");
      revalidatePath("/estrategias");
      return { status: "ok", analysis: result.analysis };
    }
    return { status: "error", error: result.status };
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }
}
