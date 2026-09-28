import { z } from "zod";

import { safeDbErrorMessage } from "@/db/pg-error";

import type { NightlyJobOutcome } from "./run-nightly-job";
import type { NightlyRunPurgeOutcome } from "./nightly-runs-repository";

const purgeReportSchema = z.union([
  z.object({ ok: z.literal(true), deleted: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false) }),
]);

const sourceReportSchema = z.object({
  source: z.string(),
  status: z.enum(["ok", "skipped", "pending", "failed"]),
  rowCount: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

const evaluationReportSchema = z.object({
  signalsWritten: z.number().int().nonnegative(),
  strategiesDeferred: z.number().int().nonnegative(),
  usersSkipped: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});

const scoringReportSchema = z.object({
  decisionsScored: z.number().int().nonnegative(),
  usersSkipped: z.number().int().nonnegative(),
  decisionsSkipped: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});

// A completed run's report: every field is a count or a closed-vocabulary
// status, never an id, email or the raw error string evaluation/scoring
// themselves produce (those can carry a decisionId or an engine detail
// string) — only a source's own SourceOutcome.error survives, and it is
// already sanitized by safeDbErrorMessage before this module ever sees it.
const completedReportSchema = z.object({
  session: z.string().nullable(),
  okSessions: z.array(z.string()),
  sources: z.array(sourceReportSchema),
  accessLogPurge: purgeReportSchema,
  unverifiedAccountPurge: purgeReportSchema,
  sessionPurge: purgeReportSchema,
  nightlyRunPurge: purgeReportSchema,
  evaluation: evaluationReportSchema.nullable(),
  scoring: scoringReportSchema,
});

// A run that threw before it could produce a NightlyJobOutcome at all: the
// only thing worth keeping is a sanitized message, built the same way
// ingest.ts already sanitizes a source's own error (SQLSTATE plus
// constraint for a Postgres error, never driver text).
const thrownReportSchema = z.object({ error: z.string() });

export const nightlyRunReportSchema = z.union([completedReportSchema, thrownReportSchema]);

export type NightlyRunReport = z.infer<typeof nightlyRunReportSchema>;

export function sourceRunStatus(source: {
  skipped: boolean;
  pending?: true;
  error?: string;
}): "ok" | "skipped" | "pending" | "failed" {
  if (source.error !== undefined) {
    return "failed";
  }
  if (source.pending) {
    return "pending";
  }
  return source.skipped ? "skipped" : "ok";
}

export function buildNightlyRunReport(
  outcome: NightlyJobOutcome & { nightlyRunPurge: NightlyRunPurgeOutcome },
): NightlyRunReport {
  return {
    session: outcome.session,
    okSessions: outcome.okSessions,
    sources: outcome.sources.map((source) => ({
      source: source.source,
      status: sourceRunStatus(source),
      rowCount: source.rowCount,
      ...(source.skippedRows !== undefined ? { skippedRows: source.skippedRows } : {}),
      ...(source.error !== undefined ? { error: source.error } : {}),
    })),
    accessLogPurge: outcome.accessLogPurge,
    unverifiedAccountPurge: outcome.unverifiedAccountPurge,
    sessionPurge: outcome.sessionPurge,
    nightlyRunPurge: outcome.nightlyRunPurge,
    evaluation: outcome.evaluation
      ? {
          signalsWritten: outcome.evaluation.signalsWritten,
          strategiesDeferred: outcome.evaluation.strategiesDeferred,
          usersSkipped: outcome.evaluation.usersSkipped,
          errorCount: outcome.evaluation.errors.length,
        }
      : null,
    scoring: {
      decisionsScored: outcome.scoring.decisionsScored,
      usersSkipped: outcome.scoring.usersSkipped,
      decisionsSkipped: outcome.scoring.decisionsSkipped,
      errorCount: outcome.scoring.errors.length,
    },
  };
}

export function buildThrownNightlyRunReport(error: unknown): NightlyRunReport {
  return { error: safeDbErrorMessage(error) };
}
