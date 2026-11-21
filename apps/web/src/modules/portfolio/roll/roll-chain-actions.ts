"use server";

import { z } from "zod";

import { requireUser, withAuthenticatedAction } from "@/modules/auth";

import { getMyRollChain } from "./roll-chain-queries";
import { rollChainToCsv } from "./roll-chain";

const idSchema = z.string().min(1).max(64);

export type DownloadRollChainCsvResult =
  { status: "ok"; csv: string } | { status: "error"; error: "invalid" };

// The roll chain's CSV, built from the same rows the page itself renders (#382): recomputed per
// request rather than cached as a file, since the chain's last link's own result can still
// change (a pending settlement not yet confirmed).
export async function downloadRollChainCsvAction(
  operationId: unknown,
): Promise<DownloadRollChainCsvResult> {
  const parsed = idSchema.safeParse(operationId);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    await requireUser();
    const rows = await getMyRollChain(parsed.data);
    return { status: "ok" as const, csv: rollChainToCsv(rows) };
  });
}
