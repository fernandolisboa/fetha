"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { analysisSubjectKinds } from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import { resolveAnalysisModelForCurrentUser } from "@/modules/ai-models";

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
        | "own_key_missing"
        | "own_key_unreadable"
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

      const resolution = await resolveAnalysisModelForCurrentUser(parsed.data.subjectKind);
      if (resolution.status === "own_key_missing") {
        return { status: "own_key_missing" as const };
      }
      if (resolution.status === "own_key_unreadable") {
        return { status: "own_key_unreadable" as const };
      }
      const client = createAnthropicAnalysisClient(resolution.apiKey);

      return requestAnalysis(
        {
          db: getDb(),
          user,
          client,
          model: resolution.model,
          family: resolution.family,
          onRejected: resolution.markRejected,
        },
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
