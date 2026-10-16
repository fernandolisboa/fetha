"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { analysisModelFamilyChoiceSchema, analysisSubjectKinds } from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";

import { AiSettingsRepository } from "./ai-settings-repository";
import { anthropicApiKeySchema } from "./api-key-schema";
import { readBetterAuthSecret } from "./env";

const KEY_VALIDATION_TIMEOUT_MS = 5_000;

export type SetAnalysisModelFamilyActionResult =
  { status: "ok" } | { status: "error"; error: "invalid" | "rate_limited" | "unavailable" };

const setFamilyInputSchema = z.strictObject({
  kind: z.enum(analysisSubjectKinds),
  family: analysisModelFamilyChoiceSchema,
});

export async function setAnalysisModelFamilyAction(
  input: z.infer<typeof setFamilyInputSchema>,
): Promise<SetAnalysisModelFamilyActionResult> {
  const parsed = setFamilyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }
  try {
    await withAuthenticatedAction(async () => {
      const repository = await forCurrentUser(getDb(), AiSettingsRepository);
      await repository.setModelFamily(
        parsed.data.kind,
        parsed.data.family === "default" ? undefined : parsed.data.family,
      );
    });
    revalidatePath("/configuracoes");
    return { status: "ok" };
  } catch {
    return { status: "error", error: "unavailable" };
  }
}

export type ApiKeyActionResult =
  | { status: "ok"; last4: string }
  | { status: "ok_removed" }
  | { status: "ok_tested" }
  | {
      status: "error";
      error:
        "invalid" | "key_invalid" | "key_unreachable" | "rate_limited" | "unavailable" | "no_key";
    };

const apiKeyInputSchema = z.strictObject({ key: z.string() });

const SAVE_RATE_LIMIT = { windowSeconds: 60, max: 5 };
const TEST_RATE_LIMIT = { windowSeconds: 60, max: 5 };

type KeyCheckResult = { ok: true } | { ok: false; error: "key_invalid" | "key_unreachable" };

async function checkKeyIsUsable(apiKey: string): Promise<KeyCheckResult> {
  try {
    const anthropic = new Anthropic({
      apiKey,
      timeout: KEY_VALIDATION_TIMEOUT_MS,
      maxRetries: 0,
    });
    await anthropic.models.list({ limit: 1 });
    return { ok: true };
  } catch (error) {
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      return { ok: false, error: "key_invalid" };
    }
    return { ok: false, error: "key_unreachable" };
  }
}

export async function saveAnthropicApiKeyAction(
  input: z.infer<typeof apiKeyInputSchema>,
): Promise<ApiKeyActionResult> {
  const parsed = apiKeyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }
  const keyParsed = anthropicApiKeySchema.safeParse(parsed.data.key);
  if (!keyParsed.success) {
    return { status: "error", error: "invalid" };
  }
  const apiKey = keyParsed.data;

  try {
    return await withAuthenticatedAction(async () => {
      const user = await requireUser();
      await enforceAccountRateLimit(getDb(), user.email, "ai-settings/save-key", SAVE_RATE_LIMIT);

      const check = await checkKeyIsUsable(apiKey);
      if (!check.ok) {
        return { status: "error", error: check.error } as const;
      }

      const repository = await forCurrentUser(getDb(), AiSettingsRepository);
      await repository.saveApiKey(apiKey, readBetterAuthSecret());
      revalidatePath("/configuracoes");
      return { status: "ok", last4: apiKey.slice(-4) } as const;
    });
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }
}

export async function testAnthropicApiKeyAction(): Promise<ApiKeyActionResult> {
  try {
    return await withAuthenticatedAction(async () => {
      const user = await requireUser();
      await enforceAccountRateLimit(getDb(), user.email, "ai-settings/test-key", TEST_RATE_LIMIT);

      const repository = await forCurrentUser(getDb(), AiSettingsRepository);
      const own = await repository.readOwnApiKey(readBetterAuthSecret());
      if (own.status === "none") {
        return { status: "error", error: "no_key" } as const;
      }
      if (own.status === "unreadable") {
        return { status: "error", error: "key_invalid" } as const;
      }
      const check = await checkKeyIsUsable(own.key);
      return check.ok
        ? ({ status: "ok_tested" } as const)
        : ({ status: "error", error: check.error } as const);
    });
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }
}

export async function removeAnthropicApiKeyAction(): Promise<ApiKeyActionResult> {
  try {
    return await withAuthenticatedAction(async () => {
      const repository = await forCurrentUser(getDb(), AiSettingsRepository);
      await repository.removeApiKey();
      revalidatePath("/configuracoes");
      return { status: "ok_removed" } as const;
    });
  } catch {
    return { status: "error", error: "unavailable" };
  }
}
