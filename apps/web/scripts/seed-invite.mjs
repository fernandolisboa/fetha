// Run by hand, locally, against fetha-preview (apps/web/.env.local) or, with
// ALLOW_PRODUCTION_DATABASE=1, production (lib/database-guard.mjs):
//   DATABASE_URL=... ALLOW_PRODUCTION_DATABASE=1 node scripts/seed-invite.mjs owner@example.com
// This is the only path that writes an invite (docs/adr/0016): no admin
// action exists to call the equivalent repository logic (YAGNI, no
// invite-management ticket exists yet), so this script is the canonical
// implementation, not a mirror of one. It is idempotent and honest about
// whether it created, reopened or left the invite untouched.
import { neon } from "@neondatabase/serverless";

import { assertWritableDatabase, guardedDatabaseEnv } from "./lib/database-guard.mjs";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/seed-invite.mjs <email>");
  process.exit(1);
}

const env = guardedDatabaseEnv(assertWritableDatabase, "seed an invite");
const normalized = email.trim().toLowerCase();
const sql = neon(env.DATABASE_URL);

const [existing] = await sql`select consumed_at from invites where email = ${normalized}`;

let outcome;
if (!existing) {
  await sql`insert into invites (id, email) values (gen_random_uuid()::text, ${normalized})`;
  outcome = "created";
} else if (existing.consumed_at === null) {
  outcome = "already_pending";
} else {
  await sql`
    update invites
    set consumed_at = null, consumed_by_user_id = null
    where email = ${normalized}
  `;
  outcome = "reopened";
}

const messages = {
  created: `Invite created for ${normalized}.`,
  already_pending: `Invite for ${normalized} was already pending; nothing changed.`,
  reopened: `Invite for ${normalized} had been consumed; reopened it.`,
};
console.log(messages[outcome]);
