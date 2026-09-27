import { neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import { MissingDatabaseUrlError } from "./errors";
import { attachPoolErrorLogger } from "./pool-error-logger";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let cachedDb: Database | undefined;

export function getDb(): Database {
  if (cachedDb) {
    return cachedDb;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new MissingDatabaseUrlError();
  }

  neonConfig.fetchEndpoint = (h) => `http://${h}:4444/sql`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = (h) => `${h}:4444/v2`;
  cachedDb = drizzle({ connection: url, schema });
  attachPoolErrorLogger(cachedDb.$client);
  return cachedDb;
}
