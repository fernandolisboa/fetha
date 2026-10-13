import { instantSchema, tickerSchema } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { safeDbErrorMessage } from "@/db/pg-error";
import {
  buildRadarView,
  radarUniverse,
  tradingSessionForDate,
  type LiquidityRule,
} from "@/modules/market-data";

import {
  pendingUnderlyings,
  saveRead,
  seedUniverse,
  sessionHasUniverse,
  universeSize,
} from "./radar-repository";
import { readUnderlying } from "./read-underlying";

// docs/adr/0066: options traded on at least 17 of the last 21 sessions (about four in five
// sessions of a trading month), this project's default.
export const RADAR_LIQUIDITY: LiquidityRule = { windowSessions: 21, minTradedSessions: 17 };

export interface RadarScanOutcome {
  session: string;
  // `pending` covers both an underlying the deadline left unread and a universe not seeded yet
  // because tonight's IV index is not computed; `failed` is a setup error.
  status: "ok" | "pending" | "failed";
  universe: number;
  // Underlyings this run read; `universe - pending` is what the session holds read so far.
  readThisRun: number;
  pending: number;
  matches: number;
  errors: number;
}

export interface ScanRadarInput {
  session: string;
  // The universe is the underlyings with an IV index point on `session`: seeding it before
  // that session's IV index is computed would freeze a partial universe.
  ivIndexComputed: boolean;
  deadlineAt?: number;
  now?: () => number;
}

function outcome(session: string, fields: Partial<RadarScanOutcome>): RadarScanOutcome {
  return {
    session,
    status: "ok",
    universe: 0,
    readThisRun: 0,
    pending: 0,
    matches: 0,
    errors: 0,
    ...fields,
  };
}

// The nightly radar step (docs/adr/0066): seeds `session`'s universe once, then reads every
// underlying still pending, one at a time, until the deadline. A later run picks up where this
// one stopped, so the step is resumable per underlying like the IV index.
export async function scanRadar(db: Database, input: ScanRadarInput): Promise<RadarScanOutcome> {
  const { session } = input;
  const now = input.now ?? Date.now;
  if (input.deadlineAt !== undefined && now() >= input.deadlineAt) {
    return outcome(session, { status: "pending" });
  }

  let pending: string[];
  let close: string;
  let universe: number;
  try {
    const trading = await tradingSessionForDate(db, session);
    if (!trading) return outcome(session, { status: "failed", errors: 1 });
    close = trading.close;

    if (!(await sessionHasUniverse(db, session))) {
      if (!input.ivIndexComputed) return outcome(session, { status: "pending" });
      const universe = (await radarUniverse(db, session, RADAR_LIQUIDITY)) ?? [];
      await seedUniverse(db, session, new Date(close), universe);
    }
    pending = await pendingUnderlyings(db, session);
    universe = await universeSize(db, session);
  } catch (error) {
    console.error("radar scan setup failed", safeDbErrorMessage(error));
    return outcome(session, { status: "failed", errors: 1 });
  }

  const at = instantSchema.parse(close);
  let readThisRun = 0;
  let matches = 0;
  let errors = 0;
  for (const underlying of pending) {
    if (input.deadlineAt !== undefined && now() >= input.deadlineAt) break;
    try {
      const ticker = tickerSchema.parse(underlying);
      const view = await buildRadarView(db, ticker, new Date(close));
      const read = await readUnderlying(view, ticker, at);
      if (!read.ok) {
        errors += 1;
        continue;
      }
      await saveRead(db, { underlying, session, reading: read.reading, matches: read.matches });
      readThisRun += 1;
      matches += read.matches.length;
    } catch (error) {
      console.error("radar scan failed for an underlying", safeDbErrorMessage(error));
      errors += 1;
    }
  }

  let left: number;
  try {
    left = (await pendingUnderlyings(db, session)).length;
  } catch {
    left = pending.length - readThisRun;
  }
  return outcome(session, {
    status: left > 0 ? "pending" : "ok",
    universe,
    readThisRun,
    pending: left,
    matches,
    errors,
  });
}
