import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export function loadMigrationStatements(tag: string): string[] {
  const path = fileURLToPath(new URL(`../../../drizzle/${tag}.sql`, import.meta.url));
  return readFileSync(path, "utf8")
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
