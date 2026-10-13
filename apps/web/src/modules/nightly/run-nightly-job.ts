import type { Database } from "@/db/client";
import type { AccessLogPurgeOutcome } from "@/modules/audit";
import type { ExpiredSessionPurgeOutcome, UnverifiedAccountPurgeOutcome } from "@/modules/auth";
import type { EvaluateSignalsOutcome } from "@/modules/strategies";
import type { ScoreAnalysesOutcome, ScoreDecisionsOutcome } from "@/modules/decisions";
import type { IngestOutcome, SourceOutcome } from "@/modules/market-data";
import type { RadarScanOutcome, ScoreSuggestionsOutcome } from "@/modules/radar";

import { purgeExpiredAccessLog } from "@/modules/audit";
import { purgeExpiredSessions, purgeUnverifiedAccounts } from "@/modules/auth";
import { scoreDueAnalyses, scoreDueDecisions } from "@/modules/decisions";
import { ingest } from "@/modules/market-data";
import { scanRadar, scoreDueSuggestions } from "@/modules/radar";
import { evaluateSignalsForSession } from "@/modules/strategies";

import { purgeExpiredNightlyRuns, type NightlyRunPurgeOutcome } from "./nightly-runs-repository";

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
  analysisScoring: ScoreAnalysesOutcome;
  suggestionScoring: ScoreSuggestionsOutcome;
  radar: RadarScanOutcome | null;
  accessLogPurge: AccessLogPurgeOutcome;
  unverifiedAccountPurge: UnverifiedAccountPurgeOutcome;
  sessionPurge: ExpiredSessionPurgeOutcome;
  nightlyRunPurge: NightlyRunPurgeOutcome;
}

// Both the cron route and the owner's manual trigger page set their own
// `export const maxDuration = 300` (Next.js requires that literal in each
// route/page file, so it cannot be imported from here); this mirrors it for
// the deadline math both share.
const MAX_DURATION_SECONDS = 300;
const SAFETY_MARGIN_MS = 15_000;

// Gated on the cotahist source's own outcome, not the whole run's `ok`:
// cotahist is the only source candles come from, so a
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

function ivIndexComputed(result: IngestOutcome): boolean {
  return (
    result.sources.find((source) => source.source === "iv_index")?.newestSessionComputed === true
  );
}

// Shared by the cron GET handler and the owner's manual Server Action
// (#51): both need the exact same purge -> ingest -> evaluate -> score -> radar
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
  const nightlyRunPurge = await purgeExpiredNightlyRuns(db);
  const result = await ingest(db, options.session ? { session: options.session } : {});
  const deadlineAt = startedAt + MAX_DURATION_SECONDS * 1000 - SAFETY_MARGIN_MS;
  const evaluation =
    cotahistSucceeded(result) && result.okSessions.length > 0
      ? await evaluateSignalsForSession(db, result.okSessions, { deadlineAt })
      : null;

  // Scoring is chained after evaluation, same run, same deadline (#29): its
  // own failures never turn an otherwise successful ingestion response into
  // a failed one, reported alongside it the same way evaluation's are.
  const scoringInput = { okSessions: cotahistSucceeded(result) ? result.okSessions : [] };
  const scoring = await scoreDueDecisions(db, scoringInput, { deadlineAt });
  // AI analyses' outlooks are scored right after decisions, on the same
  // as-of session and deadline (docs/adr/0058).
  const analysisScoring = await scoreDueAnalyses(db, scoringInput, { deadlineAt });
  // Fetha's own suggestions are scored on the same as-of session decisions were (docs/adr/0067).
  const suggestionScoring = await scoreDueSuggestions(db, scoring.asOfSession, { deadlineAt });
  // The radar reads the newest session's close after everything a user's own data depends on
  // (docs/adr/0066): it is resumable, so whatever the deadline leaves the next run reads.
  const radar =
    cotahistSucceeded(result) && result.session
      ? await scanRadar(db, {
          session: result.session,
          ivIndexComputed: ivIndexComputed(result),
          deadlineAt,
        })
      : null;

  return {
    ...result,
    evaluation,
    scoring,
    analysisScoring,
    suggestionScoring,
    radar,
    accessLogPurge,
    unverifiedAccountPurge,
    sessionPurge,
    nightlyRunPurge,
  };
}
