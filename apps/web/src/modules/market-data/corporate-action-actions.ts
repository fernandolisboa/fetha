"use server";

import { revalidatePath } from "next/cache";
import type { DecimalString } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { recordAccess } from "@/modules/audit";
import { isOwner } from "@/modules/auth";

import { sharesRatioToFactor } from "./corporate-action-factor";
import { recordCorporateActionFactorInputSchema } from "./corporate-action-validation";
import { sessionByDate } from "./repositories/calendar-repository";
import { latestCandle } from "./repositories/candle-repository";
import { upsertCorporateActionFactor } from "./repositories/corporate-action-repository";

export type RecordCorporateActionFactorResult =
  | { status: "forbidden" }
  | { status: "invalid_input" }
  | { status: "not_a_trading_session" }
  | { status: "unknown_ticker" }
  | { status: "ok"; factor: DecimalString };

// Owner-entered corporate-action factors (#50, ADR-0052 option 2): the owner
// types "N para M" from the company's own public notice, this converts it to
// the multiplier the engine's adjusted series applies to earlier sessions
// (ADR-0013). Re-checks `isOwner()` itself, from the server's own session,
// on every call — the owner-only section that renders the form is never
// trusted on its own, the same way `triggerNightlyJobAction` (#51) does not
// trust /configuracoes rendering it.
export async function recordCorporateActionFactorAction(
  input: unknown,
): Promise<RecordCorporateActionFactorResult> {
  if (!(await isOwner())) {
    return { status: "forbidden" };
  }

  const parsed = recordCorporateActionFactorInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid_input" };
  }
  const { ticker, exDate, sharesBefore, sharesAfter } = parsed.data;

  const db = getDb();
  const [session, candle] = await Promise.all([
    sessionByDate(db, exDate),
    latestCandle(db, ticker),
  ]);

  if (!session) {
    return { status: "not_a_trading_session" };
  }
  if (!candle) {
    return { status: "unknown_ticker" };
  }

  const factor = sharesRatioToFactor(sharesBefore, sharesAfter);
  await upsertCorporateActionFactor(db, {
    ticker,
    exDate,
    asOf: session.open,
    factor,
  });

  await recordAccess("corporate_action_recorded");
  revalidatePath("/configuracoes");
  return { status: "ok", factor };
}
