---
status: proposed
date: 2026-09-24
---

# Registration mode changes without a redeploy: Vercel Global Config, as in Feudo (amends 0016)

## Context

`REGISTRATION_MODE=open|invite|closed` (ADR-0016) is read from `process.env` at request time
(`apps/web/src/lib/env.ts`), but on Vercel "any change you make to environment variables are not
applied to previous deployments, they only apply to new deployments" (Vercel docs, environment
variables, checked 2026-09-22). Flipping the mode, for example `invite` → `open` before friends
register, or `open` → `closed` if something goes wrong, therefore means editing the variable and
redeploying production. `apps/web/scripts/vercel-ignore-build.sh` always builds production, so every
flip costs a full production build and several minutes before it takes effect.

Feudo already solved this. Its ADR-0001 and `docs/runbooks/auth.md` read the mode first from the
`registration_mode` item of a Vercel Global Config store (formerly Edge Config), then from
`REGISTRATION_MODE`, then default to `invite`
(`apps/web/src/platform/runtime-settings.ts`, `apps/web/src/modules/auth/registration-mode.ts`,
`@vercel/global-config` 1.5.1). The owner reports it has run without trouble, and prefers editing
an item in the Vercel dashboard over touching the database. The stack section of `CLAUDE.md` is
"same as Feudo, deviations noted", and i18n asks that "the two repos stay interchangeable".

The only read site is the `hooks.before` middleware on `/sign-up/email`
(`apps/web/src/modules/auth/options.ts`): one read per sign-up attempt, tens per year.

## Decision

**Adopt Feudo's shape unchanged: Global Config item first, environment variable second, `invite`
last.**

1. **Resolution order**, evaluated per sign-up attempt:
   1. The `registration_mode` item of the Global Config store whose connection string is in
      `GLOBAL_CONFIG`.
   2. `REGISTRATION_MODE`.
   3. `invite`.
2. **A port of Feudo's two files, not a redesign.** `createRuntimeSettings(env)` in
   `apps/web/src/lib/runtime-settings.ts` (shared kernel, imports no module, ADR-0019) exposes
   `read(key): Promise<unknown>` over `@vercel/global-config`'s `createClient`. It keeps Feudo's
   three safeguards:
   - `staleIfError: false`, so an upstream error never serves an old value.
   - A 2-second read timeout.
   - A missing or malformed `GLOBAL_CONFIG` is logged and yields "no store" instead of failing
     every auth endpoint.

   `resolveRegistrationMode(settings, env)` in `modules/auth/registration-mode.ts` applies the
   order above. It treats `null`, `""` and an unset item as unset. It logs and ignores a value
   outside the three modes: short strings (12 characters or fewer) are logged as-is, longer ones by
   length only, so a secret pasted into the wrong item never reaches the logs.

3. **Same parsing as Feudo.** `registrationModeSchema` (`@fetha/contracts`) is extended to trim and
   lower-case its input, as Feudo's does, so `Open` in the dashboard means `open`.
4. **A broken store falls back; it never opens registration by accident.** An unreachable store or
   an invalid item defers to `REGISTRATION_MODE`. Production keeps `REGISTRATION_MODE=invite` in
   Vercel as the floor.
5. **Production only.** One store, `fetha-production`, is connected to the Vercel Production
   environment only. It is separate from Feudo's store so the two apps never flip each other.
   Preview, CI and local runs have no `GLOBAL_CONFIG` and keep using the environment variable, so
   the integration and E2E suites do not change.
6. **How the owner flips it:** Vercel dashboard → Storage → `fetha-production` → Items → edit
   `registration_mode`. Vercel says the change propagates globally within 10 seconds, with no
   build. Write access to the store is the authority to open registration. Setting `open` stays
   subject to the `/security-audit` and LGPD gates in `CLAUDE.md` (principle 6).

## Consequences

- A flip is a dashboard edit that applies within seconds.
- New dependency `@vercel/global-config`, pinned to Feudo's version, and one environment variable
  (`GLOBAL_CONFIG`, set by Vercel when the store is connected).
- **Cost.** Global Config is a usage-billed resource: $3 per 1M reads and $1 per 100 writes
  (vercel.com/pricing, checked 2026-09-22), drawn from the Pro monthly credit. At one read per
  sign-up attempt this rounds to $0. The owner still approves creating the store (`CLAUDE.md`,
  paid resources) and creates and connects it, since that needs their Vercel login.
- **Latency.** Vercel quotes 15 ms or less at P99, often under 1 ms. The 2-second timeout bounds
  the worst case.
- **Tests.** Unit tests mock `createClient`, porting Feudo's `runtime-settings.test.ts`. A
  `registration-mode` unit test covers the resolution order, the logging rules and the
  case-insensitive parsing. The existing integration tests keep setting `process.env`.
- **Docs.** ADR-0016's sentence "`REGISTRATION_MODE` … is read at request time" is amended by this
  ADR, not edited. The implementing PR updates `CLAUDE.md` (the Context bullet on registration
  mode) and `.env.example` to name the store first.
- **Future settings.** Any later runtime switch goes in the same store through `RuntimeSettings`,
  one key per setting, each with its own validation and fallback.

## Alternatives considered

- **Keep environment variables only.** Zero code, but every flip costs a production build and
  minutes of delay, and an emergency `closed` should not wait on a build.
- **One typed row in Postgres, flipped by a `workflow_dispatch` GitHub Action.** This ADR's first
  draft. Rejected by the owner. It would diverge from Feudo, which already runs Global Config
  without trouble. It would also make a database write the way to change operational config,
  instead of a dashboard edit. Its main advantage, testing against the CI database, disappears
  because only production has a store.
- **Vercel Flags or a third-party flag service.** Rejected. They are built for gradual rollouts
  across many users, which one three-valued switch does not need. The Flags Explorer alone costs
  $250 a month on Pro.
