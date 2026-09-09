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

  cachedDb = drizzle({ connection: url, schema });
  attachPoolErrorLogger(cachedDb.$client);
  return cachedDb;
}
