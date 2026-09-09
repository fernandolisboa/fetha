// Run by hand, locally, with DATABASE_URL pointed at the target database:
//   DATABASE_URL=... node scripts/seed-invite.mjs owner@example.com
// This is how the first invite (the owner's own) gets into a fresh database,
// since sign-up in `invite` mode requires an existing invite. Mirrors
// src/modules/auth/invite-repository.ts's createInvite: idempotent, and
// honest about whether it created, reopened or left the invite untouched.
import { neon } from "@neondatabase/serverless";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/seed-invite.mjs <email>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const normalized = email.trim().toLowerCase();
const sql = neon(databaseUrl);

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
