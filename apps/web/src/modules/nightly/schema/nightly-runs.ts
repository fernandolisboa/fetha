import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { NightlyRunReport } from "../report";
import { nightlyRunTriggerSchema, type NightlyRunTrigger } from "./trigger";

const triggers = nightlyRunTriggerSchema.options.map((trigger) => `'${trigger}'`).join(", ");

// Operational, system-written, no `user_id` (docs/adr/0016's `invites`/
// `mail_outbox` class, extended by docs/adr/0044): one row per nightly run,
// cron or manual, so an agent can answer "did last night's job run and what
// failed" from the database instead of a Vercel log screenshot. `report` is
// pre-redacted before it ever reaches this table (see ../report.ts) — no
// user id, decision id, email or raw provider/engine error string is ever
// written here.
export const nightlyRuns = pgTable(
  "nightly_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    trigger: text("trigger").$type<NightlyRunTrigger>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    ok: boolean("ok").notNull(),
    report: jsonb("report").$type<NightlyRunReport>().notNull(),
  },
  (table) => [
    index("nightly_runs_started_at_idx").on(table.startedAt),
    check("nightly_runs_trigger_check", sql`${table.trigger} in (${sql.raw(triggers)})`),
  ],
);
