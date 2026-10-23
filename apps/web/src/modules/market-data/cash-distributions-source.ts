import type { Database } from "@/db/client";

import { detectCashDistributions } from "./cash-distribution-detection";
import type { RunResult } from "./ingest";
import { sessionBefore, sessionByDate } from "./repositories/calendar-repository";
import {
  factorTickersExDated,
  strikeTransitionsBetween,
  upsertCashDistributions,
} from "./repositories/cash-distribution-repository";
import { findSucceededRun } from "./repositories/ingestion-run-repository";

// A session's distributions are read off strikes COTAHIST lists on it and on the session
// before (docs/adr/0070), mapped to underlyings by the registry, so both sessions' cotahist and
// the session's instruments must be in first; otherwise the session pends and is retried. The
// calendar's first session has no session before it and holds nothing to detect.
export async function detectCashDistributionsForSession(
  db: Database,
  session: string,
): Promise<RunResult> {
  const trading = await sessionByDate(db, session);
  if (!trading) {
    throw new Error(`no trading session recorded for ${session}`);
  }
  const previous = await sessionBefore(db, session);
  if (!previous) {
    return 0;
  }
  const [cotahistRun, previousCotahistRun, instrumentsRun] = await Promise.all([
    findSucceededRun(db, "cotahist", session),
    findSucceededRun(db, "cotahist", previous.date),
    findSucceededRun(db, "instruments", session),
  ]);
  if (!cotahistRun || !previousCotahistRun || !instrumentsRun) {
    return { rowCount: 0, pending: true };
  }
  const [transitions, excluded] = await Promise.all([
    strikeTransitionsBetween(db, previous.date, session),
    factorTickersExDated(db, session),
  ]);
  return upsertCashDistributions(
    db,
    session,
    trading.close,
    detectCashDistributions(transitions, new Set(excluded)),
  );
}
