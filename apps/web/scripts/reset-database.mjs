// Run before `db:migrate` in CI against the shared fetha-preview project
// (docs/adr/0016-auth-and-tenancy.md, "Database topology"): drops and
// recreates the public and drizzle schemas so schema drift left over from
// any other branch never survives into the next run. Refuses to run outside
// fetha-preview (see lib/database-guard.mjs).
import { neon } from "@neondatabase/serverless";

import { assertDisposableDatabase, guardedDatabaseEnv } from "./lib/database-guard.mjs";

const env = guardedDatabaseEnv(assertDisposableDatabase, "reset the database");

const sql = neon(env.DATABASE_URL);

await sql`drop schema if exists public cascade`;
await sql`drop schema if exists drizzle cascade`;
await sql`create schema public`;
await sql`grant usage, create on schema public to public`;

console.log("fetha-preview: schemas reset.");
