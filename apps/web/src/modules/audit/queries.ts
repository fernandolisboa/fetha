import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { AccessLogRepository, type AccessLogEntry } from "./access-log-repository";

const RECENT_LIMIT = 50;

export const getMyAccessLog = cache(async (): Promise<AccessLogEntry[]> => {
  const repository = await forCurrentUser(getDb(), AccessLogRepository);
  return repository.listRecent(RECENT_LIMIT);
});
