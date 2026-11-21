"use server";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";

import { idSchema } from "../id-schema";

import { getMyRollChain } from "./roll-chain-queries";
import { rollChainToCsv } from "./roll-chain";

const DOWNLOAD_RATE_LIMIT = { windowSeconds: 60, max: 30 };

export type DownloadRollChainCsvResult =
  { status: "ok"; csv: string } | { status: "error"; error: "invalid" | "rate_limited" };

// The roll chain's CSV, built from the same rows the page itself renders (#382): recomputed per
// request rather than cached as a file, since the chain's last link's own result can still
// change (a pending settlement not yet confirmed). Rate-limited like every other roll endpoint
// (#382 review advisory): a CSV export recomputes the whole chain, so it is not free to spam.
export async function downloadRollChainCsvAction(
  operationId: unknown,
): Promise<DownloadRollChainCsvResult> {
  const parsed = idSchema.safeParse(operationId);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    try {
      await enforceAccountRateLimit(getDb(), user.email, "roll/csv", DOWNLOAD_RATE_LIMIT);
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "error" as const, error: "rate_limited" as const };
      }
      throw error;
    }
    const rows = await getMyRollChain(parsed.data);
    return { status: "ok" as const, csv: rollChainToCsv(rows) };
  });
}
