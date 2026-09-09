// Run by hand, locally, with DATABASE_URL pointed at the target database:
//   DATABASE_URL=... node scripts/seed-invite.mjs owner@example.com
// This is how the first invite (the owner's own) gets into a fresh database,
// since the protected `createInvite` server action requires an existing
// session and nobody can sign up in `invite` mode without one.
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

const sql = neon(databaseUrl);
await sql`
  insert into invites (id, email)
  values (gen_random_uuid()::text, ${email.trim().toLowerCase()})
  on conflict (email) do nothing
`;
console.log(`Invite seeded for ${email}.`);
