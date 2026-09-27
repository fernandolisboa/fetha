---
status: accepted
date: 2026-09-09
---

# Magic link, password reset and database-backed rate limiting (amends 0016)

ADR-0016 anticipated all three and deliberately left them out of ticket #9: "Magic link and
password reset are out of scope for this ticket (#10) but nothing here precludes adding them:
Better Auth's plugin API composes without touching the tables or hooks below" and "Rate limiting is
out of scope for this ticket (#10); Better Auth's defaults apply until then." Ticket #10 built all
three. This ADR amends 0016 rather than editing it in place (ADR conventions, `docs/adr/README.md`)
and was revised once, during ticket #10's own review pass (fix-forward, this same date): the
original rate limiting was IP-and-path only, which the security-audit A-01 remediation flagged as
insufficient on its own; the "Decision" section below reflects the final, account-aware shape.

## Decision

**Magic link and password reset (Better Auth's plugin API, no schema or repository change)**

- `magicLink({ disableSignUp: true })`: sign-in only, never sign-up. A click that silently created
  a new account would bypass the terms/privacy checkboxes `/sign-up/email` requires and the
  `REGISTRATION_MODE` invite gate, which only guards that one endpoint (ADR-0016).
  `storeToken: "hashed"` and the top-level `verification.storeIdentifier: "hashed"` were evaluated
  on the round-1 review pass and kept plain for this ticket, for both magic link and password
  reset: both broke the reuse/expiry integration tests, which manipulate the `verification` table's
  row directly by its plain identifier to force a token to look expired or already-consumed
  (`magic-link.integration.test.ts`, `password-reset.integration.test.ts`). The round-1 rationale
  for stopping there was wrong and is corrected here rather than repeated: Better Auth's
  `defaultKeyHasher` (`better-auth/dist/db/verification-token-storage.mjs`) is plain SHA-256 over
  the identifier, base64url-encoded without padding — reproducible in test code with Node's own
  `node:crypto` (`createHash("sha256").update(identifier).digest()` then base64url-encode), no
  `@better-auth/utils` dependency needed, and `verification.storeIdentifier` is a real, documented
  top-level option. Turning hashing on was still deferred past this ticket rather than done here
  (issue #60 tracks it with the corrected shape), not because it was infeasible. The token itself
  is still a cryptographically random, single-use, short-lived, unguessable value regardless of
  hashing; the difference only matters if the database itself is compromised.
- `magicLink`'s `sendMagicLink` looks the email up (`db.query.user.findFirst`) before sending: an
  unregistered address gets the exact same 200 response (the plugin always answers
  `{ status: true }` once its own endpoint handler runs, regardless of what this callback does) but
  never receives mail, closing an enumeration-by-inbox gap with the same no-enumeration posture
  ADR-0016 already applies to sign-up. This does not close timing-based enumeration: an existing
  account costs one extra `mailer.send` await the "no account" branch skips, an observable
  difference the response body does not carry. Filed alongside the same gap on password reset in
  issue #45 rather than fixed in this ticket.
- `emailAndPassword.sendResetPassword` sends through the same `Mailer` port as email verification
  and magic link (`buildPasswordResetEmail`, `src/modules/auth/email/`), so `mail_outbox` capture
  and the E2E verification-link route (`readE2EVerificationLink`) work for it unchanged.
- `emailAndPassword.revokeSessionsOnPasswordReset: true`: a session minted before a password reset
  is unauthenticated after it. Without this, a stolen session cookie would keep working even after
  the account owner reset their password specifically to lock an attacker out.
- Both flows share one DRY email shape: `buildLinkEmail` (`email/link-email.ts`) builds the
  subject/text/html triple for any single-`{url}` email from its copy and a URL, used by both
  `buildMagicLinkEmail` and `buildPasswordResetEmail`; `escapeHtml` (`email/escape-html.ts`) is the
  one HTML-escaping function every email builder in the module calls, including the verification
  email, which additionally interpolates a name.

**Rate limiting (database-backed, IP-and-path plus account-and-path)**

- Better Auth's `rateLimit` with `storage: "database"` against a new `rate_limits` table
  (`src/db/schema/rate-limits.ts`: `id`, `key`, `count`, `last_request`; no `user_id` — an
  operational table in the same class as `invites`/`mail_outbox`, ADR-0016), replacing the
  in-memory `Map` that reset on every cold serverless instance (security-audit finding A-01,
  `docs/security-audit/2026-09-09.md`). `RATE_LIMIT_CUSTOM_RULES` (`options.ts`) makes the
  window/max for `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`
  and `/send-verification-email` explicit, matching the values Better Auth's own defaults already
  used for the first, second and fifth so an upstream default change cannot silently loosen them;
  the magic-link plugin carries its own `rateLimit` option for `/sign-in/magic-link` and
  `/magic-link/verify`. `rate_limits`' shape (`id`, `key`, `count`, `last_request`) is fixed by
  Better Auth's own limiter, not chosen by this codebase — it reads and writes those exact field
  names directly, and the Drizzle adapter resolves the model by the schema export's name
  (`rateLimit`), which is therefore load-bearing.
- **This supersedes the original decision** to rely on Better Auth's built-in limiter alone: it
  buckets by IP and path only, so a distributed attacker rotating source IPs against one email
  address is not bounded by it at all. `enforceAccountRateLimit`
  (`src/modules/auth/account-rate-limit.ts`) adds a second, account-level bucket in the same
  `rate_limits` table, keyed `${email}|${path}` (an email always contains `@`, an IP address never
  does, so the two key shapes cannot collide), applied from `hooks.before` for
  `/sign-in/email`, `/sign-in/magic-link`, `/request-password-reset` and `/send-verification-email`
  — every endpoint an attacker could hammer to guess a password, exhaust a magic-link/reset
  send-quota, or spam a mailbox. It mirrors Better Auth's own database-storage algorithm
  (`better-auth/dist/api/rate-limiter/index.mjs`'s `consume`): read the row, reset-and-update when
  the window has elapsed, otherwise a conditional `UPDATE ... WHERE lastRequest > windowStart AND
count < max` so a losing concurrent writer re-reads and retries under the winner's row instead of
  silently overwriting it, bounded by `MAX_ATTEMPTS = 10` (`apps/web/src/modules/auth/account-rate-limit.ts`);
  exhausting the bound fails closed with the same `AccountRateLimitExceededError` (mapped to a
  `429 APIError`). Every account window must stay at or below Better Auth's longest configured window
  (currently 60s, docs/adr/0016) or its background prune could delete a live account bucket. A request
  whose body carries no valid email for that path (i.e. Zod cannot parse one) skips the account check
  entirely and still passes through Better Auth's own IP-based one.
- `advanced.ipAddress.ipAddressHeaders: ["x-real-ip", "x-forwarded-for"]`: Vercel's edge network
  always sets `x-real-ip` to the real client address and a single, trusted `x-forwarded-for` value
  (no untrusted proxy chain to walk), so both are safe to read directly. Without this, an
  unresolvable IP falls back to Better Auth's own shared `"no-trusted-ip"` bucket across every
  client the limiter cannot identify — configuring the headers keeps that fallback from ever being
  reached in practice on Vercel.
- `buildAuthOptions` takes `rateLimitEnabled` as an explicit fourth parameter, defaulting to `true`.
  **This supersedes** the original `isUnitTestEnv` inference (reading `VITEST`/`VITEST_INTEGRATION`
  from the env to decide whether a real `rate_limits` table exists): inferring test-ness from env
  vars inside production code was an unnecessary coupling for a concern only a handful of unit
  tests have; a caller that needs it off now injects `false` directly.

## Considered options

- **IP-and-path limiting only** (the shape ticket #10 shipped in its first review round): rejected
  on the round-1 review pass; it left the exact gap A-01 called out — an attacker distributing
  requests across IPs against one account is unbounded by an IP-keyed limiter alone.
- **Account-and-path limiting only, dropping the IP dimension**: rejected; the two dimensions catch
  different attacks (IP: one machine hammering many accounts; account: many machines against one
  account) and Better Auth's own limiter already provides the IP dimension for free.
- **Inferring rate-limit-off from `VITEST`/`VITEST_INTEGRATION`**: rejected on the round-1 review
  pass in favor of an explicit parameter, per this ADR's own default of pragmatism over environment
  sniffing in application code (CLAUDE.md, KISS).

## Consequences

- `docs/adr/0016-auth-and-tenancy.md` keeps its original ticket-#9 text describing magic link,
  password reset and rate limiting as out of scope, with a pointer to this ADR; the decisions
  themselves live here, not edited into 0016 (accepted ADRs are never edited in place,
  `docs/adr/README.md`).
- `rate_limits` joins `invites` and `mail_outbox` as an unscoped, system-written operational table
  (ADR-0016); it carries no `user_id` and no application code queries it directly except
  `enforceAccountRateLimit`'s own account-level bucket, which shares the table but never touches
  Better Auth's IP-keyed rows.
- Every login, magic-link, password-reset-request and resend-verification code path now returns a
  `rate_limited` outcome (`service.ts`) that the UI surfaces with the same copy as any other 429.
- The per-account `/sign-in/email` bucket counts every attempt against that email, not only failed
  ones, applied in `hooks.before` before Better Auth has evaluated the credentials: an attacker who
  knows (or guesses) a victim's email can lock the victim's own sign-in out for the window by
  sending `max` throwaway attempts, a denial-of-service trade-off accepted for this ticket in
  exchange for a limiter simple enough to apply uniformly pre-request. A failure-only counter would
  need to run from `hooks.after` once the outcome is known, and is folded into issue #45 alongside
  the other login-path enumeration and hardening follow-ups rather than built here.
