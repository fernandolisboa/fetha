import { z } from "zod";

import { safeDbErrorMessage } from "@/db/pg-error";
import type { SourceOutcome } from "@/modules/market-data";

import type { NightlyJobOutcome } from "./run-nightly-job";

const purgeReportSchema = z.union([
  z.object({ ok: z.literal(true), deleted: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false) }),
]);

const sourceReportSchema = z.object({
  source: z.string(),
  status: z.enum(["ok", "skipped", "pending", "failed"]),
  rowCount: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative().optional(),
  deferred: z.number().int().nonnegative().optional(),
  newestSessionComputed: z.boolean().optional(),
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

const analysisScoringReportSchema = z.object({
  analysesScored: z.number().int().nonnegative(),
  usersSkipped: z.number().int().nonnegative(),
  analysesSkipped: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});

const suggestionScoringReportSchema = z.object({
  scored: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});

const researchScoringReportSchema = z.object({
  scored: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});

const sentimentReportSchema = z.object({
  labels: z.object({
    status: z.enum(["off", "ran", "failed"]),
    labelled: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    unreadable: z.number().int().nonnegative(),
    retryLater: z.number().int().nonnegative(),
    deferred: z.number().int().nonnegative(),
  }),
  newsTone: z.object({
    status: z.enum(["ran", "rate_limited", "failed"]),
    refreshed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    deferred: z.number().int().nonnegative(),
  }),
  provider: z.object({
    status: z.enum(["off", "ran", "rate_limited", "failed"]),
    refreshed: z.number().int().nonnegative(),
    articles: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    deferred: z.number().int().nonnegative(),
  }),
});

const radarReportSchema = z.object({
  status: z.enum(["ok", "pending", "failed"]),
  universe: z.number().int().nonnegative(),
  readThisRun: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(),
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
  analysisScoring: analysisScoringReportSchema,
  // Optional: runs stored before docs/adr/0067 have no such field.
  suggestionScoring: suggestionScoringReportSchema.optional(),
  // Optional: runs stored before docs/adr/0076 have no such field.
  researchScoring: researchScoringReportSchema.optional(),
  // Absent from runs recorded before #310.
  sentiment: sentimentReportSchema.optional(),
  radar: radarReportSchema.nullable(),
});

// A run that threw before it could produce a NightlyJobOutcome at all: the
// only thing worth keeping is a sanitized message, built the same way
// ingest.ts already sanitizes a source's own error (SQLSTATE plus
// constraint for a Postgres error, never driver text).
const thrownReportSchema = z.object({ error: z.string() });

export const nightlyRunReportSchema = z.union([completedReportSchema, thrownReportSchema]);

export type NightlyRunReport = z.infer<typeof nightlyRunReportSchema>;

export function sourceRunStatus(
  source: Pick<SourceOutcome, "skipped" | "pending" | "error">,
): "ok" | "skipped" | "pending" | "failed" {
  if (source.error !== undefined) {
    return "failed";
  }
  if (source.pending) {
    return "pending";
  }
  return source.skipped ? "skipped" : "ok";
}

export function buildNightlyRunReport(outcome: NightlyJobOutcome): NightlyRunReport {
  return {
    session: outcome.session,
    okSessions: outcome.okSessions,
    sources: outcome.sources.map((source) => ({
      source: source.source,
      status: sourceRunStatus(source),
      rowCount: source.rowCount,
      ...(source.skippedRows !== undefined ? { skippedRows: source.skippedRows } : {}),
      ...(source.deferred !== undefined ? { deferred: source.deferred } : {}),
      ...(source.newestSessionComputed !== undefined
        ? { newestSessionComputed: source.newestSessionComputed }
        : {}),
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
    analysisScoring: {
      analysesScored: outcome.analysisScoring.analysesScored,
      usersSkipped: outcome.analysisScoring.usersSkipped,
      analysesSkipped: outcome.analysisScoring.analysesSkipped,
      errorCount: outcome.analysisScoring.errors.length,
    },
    suggestionScoring: {
      scored: outcome.suggestionScoring.scored,
      skipped: outcome.suggestionScoring.skipped,
      errorCount: outcome.suggestionScoring.errors,
    },
    researchScoring: {
      scored: outcome.researchScoring.scored,
      skipped: outcome.researchScoring.skipped,
      errorCount: outcome.researchScoring.errors,
    },
    sentiment: {
      labels: { ...outcome.sentiment.labels },
      newsTone: { ...outcome.sentiment.newsTone },
      provider: { ...outcome.sentiment.provider },
    },
    radar: outcome.radar
      ? {
          status: outcome.radar.status,
          universe: outcome.radar.universe,
          readThisRun: outcome.radar.readThisRun,
          pending: outcome.radar.pending,
          matches: outcome.radar.matches,
          errorCount: outcome.radar.errors,
        }
      : null,
  };
}

export function buildThrownNightlyRunReport(error: unknown): NightlyRunReport {
  return { error: safeDbErrorMessage(error) };
}
