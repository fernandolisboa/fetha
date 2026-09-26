import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { accountExportStream, exportFileName, t } from "@/modules/account";
import { recordAccess } from "@/modules/audit";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  UnauthenticatedError,
} from "@/modules/auth";

export const maxDuration = 60;

const EXPORT_RATE_LIMIT = { windowSeconds: 60, max: 3 };

export async function GET(): Promise<Response> {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const db = getDb();
  try {
    await enforceAccountRateLimit(db, user.email, "account/export", EXPORT_RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return new Response(t.dataExport.rateLimited, {
        status: 429,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    throw error;
  }

  await recordAccess("data_export");
  const exportedAt = new Date();
  return new Response(accountExportStream(db, user, exportedAt), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(exportedAt)}"`,
      "cache-control": "no-store",
    },
  });
}
