// Run by CI after every reset of fetha-preview (ci.yml, preview-database
// job), or by hand against a disposable database:
//   E2E_OWNER_EMAIL=... pnpm db:seed-e2e-owner
// Provisions the account the owner-gated e2e specs sign in as (#51,
// docs/adr/0042): verified, on the current terms, with a credential so the
// shell's password gate lets it through. The password is random and thrown
// away; the specs sign in through a magic link read back from the E2E-only
// route. Never production: the disposable-database guard has no override.
import { randomBytes, randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { hashPassword } from "better-auth/crypto";

import { assertDisposableDatabase, guardedDatabaseEnv } from "./lib/database-guard.mjs";
import { routeToLocalNeonProxy } from "./lib/local-neon.mjs";

const DEFAULT_E2E_OWNER_EMAIL = "dono-e2e@example.com";

// Mirrors CURRENT_TERMS_VERSION (src/modules/auth/terms.ts); this plain Node
// script cannot import that .ts module. seed-e2e-owner.integration.test.ts
// fails when the two drift, since a stale version sends the account to
// /aceitar-termos instead of the page under test.
const TERMS_VERSION = "2026-09-27.3";

// Read before the guard merges apps/web/.env.local over the environment, so
// the address a caller passes always wins over a local default.
const email = (process.env.E2E_OWNER_EMAIL || DEFAULT_E2E_OWNER_EMAIL).trim().toLowerCase();

const env = guardedDatabaseEnv(assertDisposableDatabase, "seed the e2e owner account");
routeToLocalNeonProxy(env.DATABASE_URL);

const sql = neon(env.DATABASE_URL);
const passwordHash = await hashPassword(randomBytes(32).toString("hex"));

const [upserted] = await sql.transaction([
  sql`
    insert into "user" (id, name, email, email_verified, terms_version, terms_accepted_at)
    values (${randomUUID()}, 'Dono E2E', ${email}, true, ${TERMS_VERSION}, now())
    on conflict (email) do update
      set email_verified = true,
          terms_version = excluded.terms_version,
          terms_accepted_at = excluded.terms_accepted_at,
          updated_at = now()
    returning (xmax = 0) as created
  `,
  sql`
    insert into terms_acceptances (id, user_id, terms_version)
    select ${randomUUID()}, u.id, ${TERMS_VERSION}
    from "user" u
    where u.email = ${email}
      and not exists (
        select 1 from terms_acceptances t
        where t.user_id = u.id and t.terms_version = ${TERMS_VERSION}
      )
  `,
  // A row someone else registered under this address keeps no password or
  // session of theirs once the seed marks it verified and owner-eligible.
  sql`delete from session where user_id = (select id from "user" where email = ${email})`,
  sql`
    delete from account
    where provider_id = 'credential' and user_id = (select id from "user" where email = ${email})
  `,
  sql`
    insert into account (id, account_id, provider_id, user_id, password, updated_at)
    select ${randomUUID()}, id, 'credential', id, ${passwordHash}, now()
    from "user" where email = ${email}
  `,
]);

console.log(`E2E owner account ${upserted[0]?.created ? "created" : "refreshed"} for ${email}.`);
