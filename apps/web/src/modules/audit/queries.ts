import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { AccessLogRepository, type AccessLogEntry } from "./access-log-repository";

const ACCESS_LOG_WINDOW = 500;

export const getMyAccessLog = cache(async (): Promise<AccessLogEntry[]> => {
  const repository = await forCurrentUser(getDb(), AccessLogRepository);
  return repository.listRecent(ACCESS_LOG_WINDOW);
});
