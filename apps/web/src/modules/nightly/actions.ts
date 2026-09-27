"use server";

import { getDb } from "@/db/client";
import { recordAccess } from "@/modules/audit";
import { isOwner } from "@/modules/auth";

import { runNightlyJob } from "./run-nightly-job";
import { manualTriggerInputSchema } from "./validation";

export interface SourceStatusSummary {
  source: string;
  status: "ok" | "skipped" | "failed";
}

// A redacted view of NightlyJobOutcome for the browser: the full outcome
// (other users' decisionId values, raw provider error strings) is for the
// cron response and its own logs only, never sent to a client (#51 review).
export interface TriggerNightlyJobSummary {
  ok: boolean;
  session: string | null;
  sources: SourceStatusSummary[];
  signalsWritten: number | null;
  decisionsScored: number;
}

export type TriggerNightlyJobResult =
  | { status: "forbidden" }
  | { status: "invalid_input" }
  | { status: "busy" }
  | { status: "ok"; summary: TriggerNightlyJobSummary };

function sourceStatus(source: { skipped: boolean; error?: string }): SourceStatusSummary["status"] {
  if (source.error !== undefined) {
    return "failed";
  }
  return source.skipped ? "skipped" : "ok";
}

function summarize(outcome: Awaited<ReturnType<typeof runNightlyJob>>): TriggerNightlyJobSummary {
  return {
    ok: outcome.ok,
    session: outcome.session,
    sources: outcome.sources.map((source) => ({
      source: source.source,
      status: sourceStatus(source),
    })),
    signalsWritten: outcome.evaluation ? outcome.evaluation.signalsWritten : null,
    decisionsScored: outcome.scoring.decisionsScored,
  };
}

// Guards only the owner's own manual trigger, in-process: the cron route
// never goes through this action, so its own GET always runs regardless.
// This is a single-instance guard, not a cross-instance lock — a real
// Postgres advisory lock held across the whole purge/ingest/evaluate/score
// sequence would need one pinned connection for that entire span, which
// conflicts with this repo's own documented contract that each purge and
// ingest report their own outcome independently even when a later step
// throws (run-nightly-job.ts); wrapping the sequence in one transaction to
// hold that lock would silently change that contract instead of just
// gating who may start a run.
let nightlyJobInFlight = false;

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

  if (nightlyJobInFlight) {
    return { status: "busy" };
  }

  nightlyJobInFlight = true;
  try {
    await recordAccess("nightly_triggered");
    const outcome = await runNightlyJob(getDb(), { session: parsed.data.session });
    return { status: "ok", summary: summarize(outcome) };
  } finally {
    nightlyJobInFlight = false;
  }
}
