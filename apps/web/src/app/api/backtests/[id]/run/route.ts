import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  UnauthenticatedError,
} from "@/modules/auth";
import {
  BacktestRunAlreadyCompleteError,
  BacktestRunClaimError,
  BacktestRunNotFoundError,
  runBacktestChunk,
} from "@/modules/backtests";

// A CPU- and memory-heavy job, not a fixed-cost lookup: raised well above
// the platform default so one call can make real progress on a chunk, the
// same reasoning as /api/cron/ingest.
export const maxDuration = 300;

const RUN_RATE_LIMIT = { windowSeconds: 60, max: 6 };

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  try {
    await enforceAccountRateLimit(getDb(), user.email, "backtests/run", RUN_RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
    throw error;
  }

  try {
    const outcome = await runBacktestChunk(getDb(), user, id);
    if (outcome.status === "failed") {
      return NextResponse.json({ ok: false, status: outcome.status, error: outcome.error });
    }
    return NextResponse.json({
      ok: true,
      status: outcome.status,
      sessionsDone: outcome.status === "complete" ? outcome.run.sessionsDone : outcome.sessionsDone,
      sessionsTotal:
        outcome.status === "complete" ? outcome.run.sessionsTotal : outcome.sessionsTotal,
    });
  } catch (error) {
    if (error instanceof BacktestRunNotFoundError) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (
      error instanceof BacktestRunAlreadyCompleteError ||
      error instanceof BacktestRunClaimError
    ) {
      return NextResponse.json({ ok: false, error: "already_running" }, { status: 409 });
    }
    throw error;
  }
}
