import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { requireUser, UnauthenticatedError } from "@/modules/auth";
import {
  BacktestRunAlreadyCompleteError,
  BacktestRunNotFoundError,
  runBacktestChunk,
} from "@/modules/backtests";

// Raised under ADR-0010, the same class of job as /api/cron/ingest: a
// backtest chunk runs against real market data and the engine's own
// simulation, not a fixed-cost lookup, so it gets Pro's higher ceiling
// rather than the platform default.
export const maxDuration = 300;

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
    const outcome = await runBacktestChunk(getDb(), user, id);
    return NextResponse.json({ ok: outcome.status !== "failed", ...outcome });
  } catch (error) {
    if (error instanceof BacktestRunNotFoundError) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (error instanceof BacktestRunAlreadyCompleteError) {
      return NextResponse.json({ ok: false, error: "already_complete" }, { status: 409 });
    }
    throw error;
  }
}
