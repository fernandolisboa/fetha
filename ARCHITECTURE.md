# Architecture

How the code is laid out. Domain truth is in `CONTEXT.md`, `UBIQUITOUS_LANGUAGE.md` and
`docs/adr/`; this file only says where things live and what may import what (ADR-0019).

## Workspace

```
packages/contracts   Zod schemas and derived types shared by everything (strategy files,
                     provider payloads, AI outputs, env). Owns every closed vocabulary.
packages/engine      Pure TypeScript, zero I/O. Its public interface (`api.ts`) is frozen by
                     ADR-0013 and is the only thing the web app may import (ADR-0006).
apps/web             The product: one Next.js app, organized in vertical slices.
```

`apps/web` imports `@fetha/engine` and `@fetha/contracts` by package root only, never a path
inside them. The engine never imports the app.

## Slices

A slice is `apps/web/src/modules/<m>/`: one feature, end to end, tables to screen. The "backend"
is the set of slices; `app/api` only exposes them over HTTP. Modules are deep (small entry
point, private implementation), and nothing outside a module reads its tables directly.

Anatomy of a slice (a file is present only when the module needs it):

| file                                 | role                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `schema.ts` or `schema/`             | Drizzle tables the module owns. Relative imports only (drizzle-kit and Node scripts load them without `@/`).            |
| `*-repository.ts`                    | The only code that queries those tables. User-scoped ones extend `lib/user-scoped-repository`; user comes from session. |
| `actions.ts`                         | Server Actions (`"use server"`): parse the form, get the user, call the repository or the engine.                       |
| `queries.ts`                         | Read models for pages, already scoped to the current user.                                                              |
| `components/`, `editor/`, `builder/` | React components of the feature; client components import only `client.ts` of other modules.                            |
| `strings.ts`                         | User-facing copy (`en` source, pt-BR shipped) and the module's `t`.                                                     |
| `index.ts`                           | Server entry point: what pages, route handlers and other modules may use.                                               |
| `client.ts`                          | Client-safe entry point: components, actions and types free of `next/headers` and Drizzle.                              |
| `*.test.ts`, `*.integration.test.ts` | Unit tests next to the code; integration tests against a local Postgres in CI, `fetha-preview` locally.                 |

## Entry points and the dependency rule

Code outside a module may import exactly three paths, enforced by ESLint
(`import/no-restricted-paths`, one zone per module):

- `@/modules/<m>` (`index.ts`): server-side API.
- `@/modules/<m>/client` (`client.ts`): what a `"use client"` component may pull in.
- `@/modules/<m>/schema`: the tables, for foreign keys from another module's schema and for
  `src/db/schema.ts`. A foreign key is a database relation, not a dependency on behavior, so
  `schema → schema` is the one sanctioned cross-module link at the table level.

Inside a module imports are relative, never through the module's own `@/modules/<m>` alias.
`src/app` and `src/db` import only entry points; `src/lib` and `src/components` import no module
at all. The only
exemption is `*.integration.test.ts` and `src/db/test/**`, which seed reference data through
`market-data`'s private repositories on purpose: market data is read-only to user-facing code
(CLAUDE.md principle 5), so no entry point exposes a writer.

Cycles are not forbidden by lint, and none exists: `shell` depends on `market-data` (the market
bar formats close freshness with `market-data/client`), never the reverse. `InstrumentMarketBar`,
which a page renders to publish its instrument into the bar, lives in `shell` for that reason
(#95). Keep the edge one-way.

## `app/` is transport

Pages under `src/app/(shell)/…` and the public auth pages are thin: get the session, call one
or two module entry points, render. Route handlers under `src/app/api/` are the four adapters
(`auth/[...all]` delegates to Better Auth; `account/export` streams the signed-in user's data export (ADR-0027); `cron/ingest` authenticates the bearer (Vercel Cron's `CRON_SECRET`, its only
trigger now) and calls `nightly`'s `runNightlyJob` (purges, `ingest`, `evaluateSignalsForSession`,
`scoreDueDecisions`, one shared `maxDuration` budget; a failed ingest still turns the response
into a 500 (`ingest`'s own `ok` decides the status), but evaluation's and scoring's own failures
are reported alongside an otherwise successful ingest's 200 rather than turning it into one) — the
owner's manual re-run is `nightly`'s own `triggerNightlyJobAction` Server Action instead, gated on
`isOwner()` (ADR-0042), never this route;
`backtests/[id]/run` runs one chunk) plus E2E-only helpers. A handler parses, authenticates,
calls the module, maps errors to responses;
it holds no business rule. `getDb()` is obtained at this edge and passed into the module.
`src/proxy.ts` is the per-request edge in front of every document: it draws the nonce and sets
the document's whole Content-Security-Policy (ADR-0035). `src/instrumentation-client.ts` runs before hydration and holds
browser bootstrap settings only (Zod `jitless`).

## Shared kernel

- `src/db/client.ts`: the Neon connection and the `Database` type. `src/db/schema.ts` is the
  barrel that re-exports every module's schema for drizzle-kit and the Drizzle client.
- `src/db/pg-error.ts`: `postgresErrorOf`, the Postgres driver error behind a bare or
  drizzle-wrapped (`DrizzleQueryError.cause`) failure. Every module classifies SQLSTATEs through
  it instead of hand-rolling the shape check.
- `src/lib/`: formatters (`format/brl`, `format/parse-money`, `decimal`, `percent`, `date-time`),
  `theme/contrast`, `runtime-settings`, `instant`, `today-sao-paulo`, `utils`,
  `user-scoped-repository`, `security-headers` (static headers from `next.config.ts`), `document-policy`
  (the per-request document policy). No business rules, no module imports.
- `src/components/ui/`: shadcn/ui primitives restyled through `DESIGN.md` tokens.
- `src/components/`: app-owned shared components built on those primitives (`error-notice`).
  No module imports.

## Modules

"Depends on" lists production imports of other modules' entry points (tests excluded);
`(client)` means only `client.ts` is used.

| module        | owns (tables)                                                                                                                       | exposes (`index.ts` / `client.ts`)                                                                                                                                                                                                                                                                                                                                                                                                            | depends on                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `auth`        | `user`, `session`, `account`, `verification` (Better Auth, generated), `invites`, `mail_outbox`, `rate_limits`, `terms_acceptances` | `getSession`, `requireUser`, `forCurrentUser`, `withAuthenticatedAction`, `hasPassword`, `readTermsGate`, the sign-up/sign-in/magic-link/password-reset/sign-out/delete-account/accept-terms actions and forms, `authRouteHandlers`, `TermsAcceptanceRepository`, `enforceAccountRateLimit`, `readE2EVerificationLink`                                                                                                                        | none                                                                                             |
| `audit`       | `access_log`                                                                                                                        | `recordAccess`, `getMyAccessLog`, `purgeExpiredAccessLog`, `AccessLogRepository`, `AccessLogPanel`                                                                                                                                                                                                                                                                                                                                            | `auth`                                                                                           |
| `preferences` | `preferences`                                                                                                                       | `getPreferences`, `setThemeAction`, `setRailCollapsedAction`, `ThemePicker`, `themes`, `themeSchema` / client: the two actions                                                                                                                                                                                                                                                                                                                | `auth`                                                                                           |
| `market-data` | `candles`, `option_series`, `option_daily_prices`, `corporate_action_factors`, `macro_points`, `trading_sessions`, `ingestion_runs` | `ingest`, `freshness`, `loadMarketView`, `buildOperationMarketView`, `loadCandleSeries`, `searchInstruments`, `latestCandle`, `optionChainForUnderlying`, `optionSeriesForFills`, `buildPortfolioMarketView`, `latestExpiredTradedSeries` (E2E), calendar helpers, `CandleChart` / client: `InstrumentSearchResult`, close-freshness helpers                                                                                                  | none                                                                                             |
| `strategies`  | `strategies`, `strategy_versions`, `signals`, `evaluations`, `structures`                                                           | strategy and signal actions, `getMyStrategies`, `getMyStrategy`, `getSharedStrategies`, `getMySignals`, `getMyEvaluationLog`, `getStructures`, `evaluateSignalsForSession`, `StrategiesRepository`, `StructuresRepository`, `StrategyEditorForm`, signal components / client: `ArchiveStrategyButton`, `UnarchiveStrategyButton`                                                                                                              | `auth`, `market-data`, `portfolio`, `watchlist`, `shell` (client)                                |
| `watchlist`   | `watchlist_items`                                                                                                                   | `getMyWatchlist`, add/remove/search actions, `WatchlistRepository`, `AddInstrumentCombobox`, `RemoveFromWatchlistButton`                                                                                                                                                                                                                                                                                                                      | `auth`, `market-data`                                                                            |
| `portfolio`   | `contemplated_operations`, `risk_profiles`, `fills`, `operations`                                                                   | `priceOperationAction`, `saveOperationAction`, `loadChainAction`, `declareRiskProfileAction`, the fill, grouping and settlement actions, `getMyOperations`, `getMyPortfolio`, `getMyHeldOperation`, `heldOperationForScoring`, `getCurrentRiskProfile`, `OperationsRepository`, `RiskProfileRepository`, `PortfolioDashboard` / client: `OperationBuilderForm`, `RiskProfileForm`, `ImportFillsDialog`, `RecordFillDialog`                    | `auth`, `audit`, `market-data`, `strategies`, `shell` (client)                                   |
| `backtests`   | `backtest_runs`                                                                                                                     | `runBacktestChunk`, `getMyBacktestRun`, `getMyBacktestRunsForStrategy`, `getMyActiveBacktestRuns`, `getMyComparison`, `compareHref`, `isActiveRun`, `isDiscardedRun`, the run error classes, `ReportPanel`, `ComparisonView`, `CompareRunsPicker` / client: `CreateRunForm`, `RunBacktestButton`, `DiscardRunButton`                                                                                                                          | `auth`, `market-data`, `portfolio`, `strategies`, `watchlist`, `shell`                           |
| `shell`       | none                                                                                                                                | `AppShell`, `Panel`, `EmptyState`, `PageHeader`, `InstrumentMarketBar` / client: `Panel`, `EmptyState`                                                                                                                                                                                                                                                                                                                                        | `auth`, `preferences`, `market-data` (client)                                                    |
| `decisions`   | `decisions`, `decision_scores`                                                                                                      | `allowedDecisionKinds`, `getMyDecisions`, `getMyDecisionsBySignalId`, `getMyDecisionsByOperationId`, `getMyDecisionsByHeldOperationId`, `getMyDecisionScores`, `getMyTrackRecordStats`, `defaultHorizonsForSignals`, `defaultHorizonsForOperations`, `defaultHorizonForHeldOperation`, `scoreDueDecisions`, `DecisionsRepository`, `DecisionScoresRepository`, `DecisionListItem`, `JournalEntry`, `TrackRecordPanel` / client: `DecisionBar` | `auth`, `audit`, `market-data`, `strategies`, `portfolio`, `backtests`, `shell` (client)         |
| `account`     | none                                                                                                                                | `accountExportStream`, `exportFileName`, `ExportDataLink`                                                                                                                                                                                                                                                                                                                                                                                     | `auth`, `audit`, `preferences`, `watchlist`, `strategies`, `portfolio`, `backtests`, `decisions` |
| `nightly`     | none                                                                                                                                | `runNightlyJob`, `triggerNightlyJobAction`, `NightlyTriggerPanel`                                                                                                                                                                                                                                                                                                                                                                             | `auth`, `audit`, `market-data`, `strategies`, `decisions`                                        |

`engine` is not a slice: it is `packages/engine`, consumed through its frozen interface by
`strategies`, `portfolio`, `backtests`, `market-data` and `decisions`.

A strategy is never a folder: strategies are declarative data (ADR-0008), rows the `strategies`
slice manages. That slice is the largest today because it carries two subjects, the catalog and
definition editor, and the nightly evaluation with its signal inbox. If it keeps growing, `signals`
is the natural next slice to split out; no other split is planned.

## Adding a module

Create `modules/<m>/` with its `schema.ts`, repository, `index.ts` and (if needed) `client.ts`;
add one line to `src/db/schema.ts`, one row above, and an isolation test for
every user-scoped table (CLAUDE.md principle 5). A module with user-scoped tables also exposes a
`<Module>DataExport` and joins the `account` export list; the export test fails until it does
(ADR-0027).
