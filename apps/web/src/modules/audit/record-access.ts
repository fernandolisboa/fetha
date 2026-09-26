import { headers } from "next/headers";
import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { AccessLogRepository } from "./access-log-repository";
import type { AccessEvent } from "./events";
import { readAccessContext } from "./request-context";

// Memoized per request: a page that reads decisions three times writes one
// row (docs/adr/0027).
export const recordAccess = cache(async (event: AccessEvent): Promise<void> => {
  const repository = await forCurrentUser(getDb(), AccessLogRepository);
  await repository.record(event, readAccessContext(await headers()));
});
