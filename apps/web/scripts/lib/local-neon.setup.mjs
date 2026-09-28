import { routeToLocalNeonProxy } from "./local-neon.mjs";

if (process.env.DATABASE_URL) {
  routeToLocalNeonProxy(process.env.DATABASE_URL);
}

// Every integration suite needs Better Auth's own secret and base URL, not
// just the ones that exercise sign-in directly: buildAuthOptions() reads
// BETTER_AUTH_SECRET unconditionally, and, since #191, so does the account
// rate limiter Server Actions call outside any hooks. Set here once, so a
// local run with no apps/web/.env.local (no `vercel env pull`) still has
// them, instead of duplicating the same fallback in every *.integration.test.ts.
process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
