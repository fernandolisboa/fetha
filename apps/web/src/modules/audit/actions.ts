"use server";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";

import {
  AccessLogRepository,
  type AccessLogCursor,
  type AccessLogEntry,
} from "./access-log-repository";
import {
  ACCESS_LOG_PAGE_SIZE,
  listAccessLogInputSchema,
  type ListAccessLogInput,
} from "./access-log-input";

const RATE_LIMIT = { windowSeconds: 10, max: 30 };

export type ListAccessLogActionResult =
  | {
      status: "ok";
      entries: AccessLogEntry[];
      nextCursor: AccessLogCursor | null;
      total: number | null;
    }
  | { status: "error"; error: "invalid" | "rate_limited" };

export type ListAccessOriginsActionResult =
  { status: "ok"; origins: string[] } | { status: "error"; error: "rate_limited" };

export async function listMyAccessLogAction(
  input: ListAccessLogInput,
): Promise<ListAccessLogActionResult> {
  const parsed = listAccessLogInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  const user = await withAuthenticatedAction(() => requireUser());
  try {
    await enforceAccountRateLimit(getDb(), user.email, "audit/access-log", RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }

  return withAuthenticatedAction(async () => {
    const repository = await forCurrentUser(getDb(), AccessLogRepository);
    const { from, to, event, ipAddress } = parsed.data;
    const filters = { from, to, event, ipAddress };
    const cursor: AccessLogCursor | null = parsed.data.cursor
      ? { occurredAt: new Date(parsed.data.cursor.occurredAt), id: parsed.data.cursor.id }
      : null;

    const [{ entries, nextCursor }, total] = await Promise.all([
      repository.listPage(filters, cursor, ACCESS_LOG_PAGE_SIZE),
      cursor ? Promise.resolve(null) : repository.count(filters),
    ]);

    return { status: "ok", entries, nextCursor, total };
  });
}

export async function listMyAccessOriginsAction(): Promise<ListAccessOriginsActionResult> {
  const user = await withAuthenticatedAction(() => requireUser());
  try {
    await enforceAccountRateLimit(getDb(), user.email, "audit/access-log", RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }

  return withAuthenticatedAction(async () => {
    const repository = await forCurrentUser(getDb(), AccessLogRepository);
    const origins = await repository.listOrigins();
    return { status: "ok", origins };
  });
}
