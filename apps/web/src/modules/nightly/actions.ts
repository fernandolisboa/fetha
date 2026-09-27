"use server";

import { sessionDateSchema } from "@fetha/contracts";
import { z } from "zod";

import { getDb } from "@/db/client";
import { isOwner } from "@/modules/auth";

import { runNightlyJob, type NightlyJobOutcome } from "./run-nightly-job";

export const manualTriggerInputSchema = z
  .object({ session: sessionDateSchema.optional() })
  .strict();

export type TriggerNightlyJobResult =
  | { status: "forbidden" }
  | { status: "invalid_input" }
  | { status: "ok"; outcome: NightlyJobOutcome };

// The owner's manual trigger (#51): a session-authenticated Server Action
// restricted to the OWNER_EMAILS allowlist, replacing the CRON_SECRET-gated
// POST the manual trigger used to be. The hidden UI on /configuracoes is
// never trusted on its own — this re-checks isOwner() itself, from the
// server's own session, on every call.
export async function triggerNightlyJobAction(input: unknown): Promise<TriggerNightlyJobResult> {
  if (!(await isOwner())) {
    return { status: "forbidden" };
  }

  const parsed = manualTriggerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid_input" };
  }

  const outcome = await runNightlyJob(getDb(), { session: parsed.data.session });
  return { status: "ok", outcome };
}
