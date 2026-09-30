import type { DecimalString } from "@fetha/contracts";

import { getDb } from "@/db/client";

import {
  recentCorporateActionFactors,
  type CorporateActionFactorRow,
} from "./repositories/corporate-action-repository";

export interface RecentCorporateActionFactor {
  ticker: string;
  exDate: string;
  factor: DecimalString;
  recordedAt: string;
}

function toRecent(row: CorporateActionFactorRow): RecentCorporateActionFactor {
  return {
    ticker: row.ticker,
    exDate: row.exDate,
    factor: row.factor,
    recordedAt: row.recordedAt.toISOString(),
  };
}

const RECENT_FACTORS_LIMIT = 50;

// A plain server-only read, not a `"use server"` export: every exported
// function in a `"use server"` file becomes a POST-able Server Action with
// no session check of its own, and this one has none — it is reference
// data, safe to read, but only ever meant to be called from
// `/configuracoes`'s own server component, which is itself the owner-only
// gate. Called from there through `index.ts`, never from a client
// component.
export async function recentCorporateActionFactorsList(): Promise<RecentCorporateActionFactor[]> {
  const rows = await recentCorporateActionFactors(getDb(), RECENT_FACTORS_LIMIT);
  return rows.map(toRecent);
}
