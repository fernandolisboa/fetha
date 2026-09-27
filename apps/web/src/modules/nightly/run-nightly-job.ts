import type { Database } from "@/db/client";
import type { AccessLogPurgeOutcome } from "@/modules/audit";
import type { ExpiredSessionPurgeOutcome, UnverifiedAccountPurgeOutcome } from "@/modules/auth";
import type { EvaluateSignalsOutcome } from "@/modules/strategies";
import type { ScoreDecisionsOutcome } from "@/modules/decisions";
import type { IngestOutcome, SourceOutcome } from "@/modules/market-data";

import { purgeExpiredAccessLog } from "@/modules/audit";
import { purgeExpiredSessions, purgeUnverifiedAccounts } from "@/modules/auth";
import { scoreDueDecisions } from "@/modules/decisions";
import { ingest } from "@/modules/market-data";
import { evaluateSignalsForSession } from "@/modules/strategies";

export interface NightlyJobOptions {
  session?: string;
}

export interface NightlyJobOutcome {
  ok: boolean;
  session: string | null;
  okSessions: string[];
  sources: SourceOutcome[];
  evaluation: EvaluateSignalsOutcome | null;
  scoring: ScoreDecisionsOutcome;
  accessLogPurge: AccessLogPurgeOutcome;
  unverifiedAccountPurge: UnverifiedAccountPurgeOutcome;
  sessionPurge: ExpiredSessionPurgeOutcome;
}

// Both the cron route and the owner's manual trigger page set their own
// `export const maxDuration = 300` (Next.js requires that literal in each
// route/page file, so it cannot be imported from here); this mirrors it for
// the deadline math both share.
const MAX_DURATION_SECONDS = 300;
const SAFETY_MARGIN_MS = 15_000;

// Gated on the cotahist source's own outcome, not the whole run's `ok`
// (#19 round 2 item 1): cotahist is the only source candles come from, so a
// night Bacen SGS or the instruments registry fails must not suppress
// evaluation for every session cotahist actually drained cleanly — that
// suppression previously compounded silently because `since` was anchored
// on the ingestion calendar instead of each user's own watermark
// (evaluate-signals.ts), so the skipped sessions were never retried once a
// later run's drained range moved past them.
function cotahistSucceeded(result: IngestOutcome): boolean {
  const cotahist = result.sources.find((source) => source.source === "cotahist");
  return cotahist !== undefined && cotahist.error === undefined;
}

// Shared by the cron GET handler and the owner's manual Server Action
// (#51): both need the exact same purge -> ingest -> evaluate -> score
// sequence and response shape, only the caller and its authorization differ.
export async function runNightlyJob(
  db: Database,
  options: NightlyJobOptions = {},
): Promise<NightlyJobOutcome> {
  const startedAt = Date.now();
  // Retention purges run first, so a night ingestion throws cannot skip the
  // deletions the privacy policy promises (docs/adr/0016, 0027, 0033). Each
  // reports its own failure alongside, never as a 500.
  const accessLogPurge = await purgeExpiredAccessLog(db);
  const unverifiedAccountPurge = await purgeUnverifiedAccounts(db);
  const sessionPurge = await purgeExpiredSessions(db);
  const result = await ingest(db, options.session ? { session: options.session } : {});
  const deadlineAt = startedAt + MAX_DURATION_SECONDS * 1000 - SAFETY_MARGIN_MS;
  const evaluation =
    cotahistSucceeded(result) && result.okSessions.length > 0
      ? await evaluateSignalsForSession(db, result.okSessions, { deadlineAt })
      : null;

  // Scoring is chained after evaluation, same run, same deadline (#29): its
  // own failures never turn an otherwise successful ingestion response into
  // a failed one, reported alongside it the same way evaluation's are.
  const scoring = await scoreDueDecisions(
    db,
    { okSessions: cotahistSucceeded(result) ? result.okSessions : [] },
    { deadlineAt },
  );

  return {
    ...result,
    evaluation,
    scoring,
    accessLogPurge,
    unverifiedAccountPurge,
    sessionPurge,
  };
}
