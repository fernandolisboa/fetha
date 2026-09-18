---
status: accepted
date: 2026-09-18
---

# Vertical slices inside the single Next.js app: a module owns its tables

## Context

The owner asked for a layout a developer can read feature by feature and did not want "the
API/backend living inside `apps/web`". Ticket #94 surveyed the tree: `apps/web/src/modules/<m>/`
already held each feature's actions, queries, repositories, components, strings and tests; the
route handlers under `app/api` were three thin adapters (Better Auth catch-all, cron ingest,
backtest run chunk) plus an E2E helper; pages under `app/` were thin; production code never
imported another module's internals. Three things were still horizontal: every module's Drizzle
tables sat in `apps/web/src/db/schema/*.ts`; the rule "import other modules only through
`index.ts` or `client.ts`" was discipline, not lint; no file described the layout.

## Decision

1. **A slice is `apps/web/src/modules/<m>/` and it owns its tables.** The schema files moved by
   `git mv`, with no SQL change (`pnpm db:generate` produces no migration), into their owning
   module. A module with one schema file exposes it as `modules/<m>/schema.ts`; a module with
   several keeps them under `modules/<m>/schema/` with an `index.ts` re-exporting them. Either
   way the import path is `@/modules/<m>/schema`. The Better Auth generated file is
   `modules/auth/schema/better-auth.ts`; `pnpm db:auth-schema` writes there.
2. **Schema files use relative imports only**, so drizzle-kit and the plain-Node scripts load
   them without the `@/` alias. A foreign key across modules is a schema-to-schema import (for
   example `backtests/schema.ts` imports `user` from `../auth/schema` and
   `strategyVersions` from `../strategies/schema`). That is the one legitimate
   cross-module dependency at the table level: a foreign key is a database relation, not a code
   dependency on behavior.
3. **`apps/web/src/db/schema.ts` is the aggregating barrel** `drizzle.config.ts` reads and
   `db/client.ts` passes to Drizzle. `src/db/client.ts` (connection), `src/lib/` and
   `src/components/ui/` remain the shared kernel with no business rules; `lib` does not import
   modules (ADR-0016, `src/lib/user-scoped-repository.ts`).
4. **Three entry points per module, enforced by lint.** Code outside a module may import only
   `@/modules/<m>` (`index.ts`, server), `@/modules/<m>/client` (client-safe) and
   `@/modules/<m>/schema` (tables). ESLint's `import/no-restricted-paths` (`eslint-plugin-import`,
   bundled with `eslint-config-next`) carries one zone per module, plus zones so that `src/app`
   and `src/db` import only entry points and `src/lib` and `src/components` import no module.
   Exempt:
   `*.integration.test.ts` and `src/db/test/**`, which seed reference data through
   module-private repositories on purpose (market data is read-only to user-facing code,
   CLAUDE.md principle 5; documented in `modules/market-data/index.ts`). Inside a module, imports
   are relative, never through the module's own alias.
5. **`app/` is transport.** Route handlers and pages parse, authenticate, call module entry
   points and map errors to responses. The "backend" is the modules; `app/api` only exposes them
   over HTTP.
6. **Earlier ADRs are not edited.** ADR-0015, 0016, 0017 and 0018 cite `src/db/schema/<x>.ts`
   paths; the map below lets a reader follow them.

| before (`apps/web/src/db/schema/`) | after (`apps/web/src/modules/`)                           |
| ---------------------------------- | --------------------------------------------------------- |
| `auth.ts`                          | `auth/schema/better-auth.ts`                              |
| `invites.ts`                       | `auth/schema/invites.ts`                                  |
| `mail-outbox.ts`                   | `auth/schema/mail-outbox.ts`                              |
| `rate-limits.ts`                   | `auth/schema/rate-limits.ts`                              |
| `terms-acceptances.ts`             | `auth/schema/terms-acceptances.ts`                        |
| `market-data.ts`                   | `market-data/schema.ts`                                   |
| `strategies.ts`                    | `strategies/schema/strategies.ts`                         |
| `signals.ts`                       | `strategies/schema/signals.ts`                            |
| `structures.ts`                    | `strategies/schema/structures.ts`                         |
| `backtests.ts`                     | `backtests/schema.ts`                                     |
| `operations.ts`                    | `portfolio/schema/operations.ts`                          |
| `risk-profiles.ts`                 | `portfolio/schema/risk-profiles.ts`                       |
| `preferences.ts`                   | `preferences/schema.ts`                                   |
| `watchlist.ts`                     | `watchlist/schema.ts`                                     |
| `index.ts`                         | `apps/web/src/db/schema.ts` (barrel, outside the modules) |

## Consequences

- `ARCHITECTURE.md` at the repo root is the one map of the slices (anatomy, entry points,
  dependency rule, one row per module). It is the only such file: a README per module was
  rejected because it would restate each `index.ts` and drift in eight places.
- A new module ships with its own `schema.ts` (or `schema/`), an `index.ts`, a `client.ts` when a
  client component needs it, one line in `src/db/schema.ts`, one lint zone and its row in
  `ARCHITECTURE.md`.
- Deep imports that lint now forbids fail the PR instead of a reviewer's eye; the integration-test
  exemption is the only sanctioned way to touch a module's private repository from outside.
- Nothing changes at runtime: same tables, same migrations, same deployment.

## Alternatives considered

- **A separate backend app (`apps/api`)**: rejected. It contradicts the closed stack (server code
  lives in Server Actions and Route Handlers), ADR-0016's Better Auth `nextCookies` cookie flow
  and Vercel `maxDuration` on one deployment, and doubles deploy, env and build cost.
- **One `packages/<feature>` per slice**: rejected. A package boundary is harder than a lint zone,
  but multiplies tsconfig, eslint and vitest configs by eight and slows CI, with no payoff for a
  solo project operated by agents.
- **Renaming `apps/web` to `apps/fetha`**: deferred. It touches the Vercel root directory, CI and
  about twenty doc links for a cosmetic gain.
- **A README per module**: rejected, see Consequences.
