import { drizzle } from "drizzle-orm/neon-serverless";

import { routeToLocalNeonProxy } from "../../scripts/lib/local-neon.mjs";
import { MissingDatabaseUrlError } from "./errors";
import { attachPoolErrorLogger } from "./pool-error-logger";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let cachedDb: Database | undefined;

export function getDb(): Database {
  if (cachedDb) {
    return cachedDb;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new MissingDatabaseUrlError();
  }

  routeToLocalNeonProxy(url);
  cachedDb = drizzle({ connection: url, schema });
  attachPoolErrorLogger(cachedDb.$client);
  return cachedDb;
}
