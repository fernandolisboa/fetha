# Fetha

Personal trading and investment lab for the Brazilian market (B3). A PWA that ingests market
data, computes indicators, options prices, structure payoffs and backtests deterministically, and
lets an AI layer reason over those computed artifacts. A free decision-support tool: no fees, no
plans, no order execution. Every decision is the user's own and is recorded in a scored journal.

Product scope lives in `PRODUCT.md`. Domain truth lives in `CONTEXT.md`, `UBIQUITOUS_LANGUAGE.md`
and `docs/adr/`. Visual truth lives in `DESIGN.md`. When this file and those disagree, those win.

## Context

- Solo project. Owner: `fernandolisboa` on GitHub. No other contributors.
- **Multi-user by design, single user in practice.** The owner is the first and, for now, only
  user; family or friends may get access later. Nothing in schema, queries or copy may assume a
  specific user. Self-registration is the product default; `REGISTRATION_MODE=open|invite|closed`
  (env) is an operational switch, not a design constraint. Launches as `invite`.
- The owner does not read code. Tests and the review pipeline are their eyes; "I'll review it"
  means the reviewers will. Optimize for verifiability, not for human reading.
- Language: talk to the owner in Portuguese (pt-BR). Think, code, name things, write commits,
  tickets, docs and ADRs in English. User-facing strings ship in pt-BR (see **i18n**).
- Agents do the work end to end: repo, config, CI, deploy. The owner steps in for logins, secrets
  and approvals.
- Data stays clean: licensed or public sources only, no scraping against terms of service. The
  in-product terms of use state that every decision is the user's own.
- Usage reality: desktop-first, nearly all access from the owner's Windows PC as an installed PWA.

## What we are building

1. **Market data**: daily reference data (candles, option series and prices, macro series, calendar)
   shared by all users; an optional per-user intraday tier (live quotes, chain, 15m/30m/60m candles).
2. **Engine**: indicators, options pricing and greeks, payoff of multi-leg structures (travas,
   collars, covered calls, butterflies, condors...), event-driven backtester, portfolio and risk
   metrics; daily and intraday strategy evaluation into a signal inbox.
3. **Strategy catalog**: declarative strategy definitions that can be backtested, versioned and
   compared. Definitions come from standard references (Hull, B3 materials), never from copying
   anyone's content.
4. **Charts**: candles with overlays, payoff diagrams, equity curves, drawdown, distribution of
   returns.
5. **AI decision layer**: reasons over engine outputs, argues both sides, flags tail risk, keeps a
   decision journal that is later scored against actual outcomes.
6. **Real portfolio**: fills entered by hand or imported from the B3 investor-area export,
   grouped into operations, marked to market; no broker connection, no order execution.

## Stack (closed; same as Feudo, deviations noted)

Single Next.js app, TypeScript end to end. Server-side code lives in Server Actions and Route
Handlers.

- **Framework**: Next.js (App Router) + TypeScript strict. `pnpm` workspace: `apps/web`,
  `packages/engine`, `packages/contracts`.
- **`packages/engine`**: pure TypeScript, zero I/O, zero framework imports. Market data model,
  indicators, strategy DSL types, options pricing (Black-Scholes, greeks, implied vol), payoff of
  structures, backtester (no look-ahead by construction), portfolio and risk metrics.
  Property-based tests with `fast-check` wherever math allows. Its public interface was designed
  deliberately in Phase 2 (three candidate shapes, compared) and frozen in ADR-0013: it is the
  seam most likely to be optimized or replaced, so nothing outside the package may depend on its
  internals.
- **`packages/contracts`**: Zod schemas and derived types shared by `apps/web` and the engine
  edges (strategy files, provider payloads, AI outputs, env).
- **PWA**: Serwist, installable on Windows. Offline: cached shell only.
- **UI**: React + Tailwind CSS. **shadcn/ui is mandatory for interactive primitives** (dialog,
  dropdown, select, combobox, popover, tabs, toast, form controls). Never hand-roll these.
  Components are copied into the repo and restyled through `DESIGN.md` tokens. TradingView
  `lightweight-charts` for price/candles; `visx` for analytics charts.
- **Database**: Postgres on Neon via the Vercel integration (`main` = prod, preview branch per
  PR). Drizzle ORM + drizzle-kit migrations committed to the repo. Time series in
  monthly-partitioned tables. Prices as fixed-point decimals (`decimal.js` / Drizzle `numeric`),
  money as integer centavos. **Never JavaScript `number` for money.**
- **Auth & tenancy**: same library and module shape as Feudo per its ADR (email + password with
  verification, magic link, password reset, sessions, rate-limited auth endpoints). The tenant is
  the user account; no shared workspaces in v1. Emails via Resend.
- **Jobs**: Vercel Cron hitting bearer-protected Route Handlers for daily data ingestion.
  Backtests run in Route Handlers with `maxDuration` raised; if a run exceeds the limit, chunk it
  before considering any other infrastructure.
- **Data providers** behind a `MarketDataProvider` interface (ADR-0007): public B3 files (COTAHIST,
  instruments registry), Bacen SGS and the ANBIMA calendar as shared reference data; brapi.dev Pro
  as the per-user intraday tier (token supplied by the user; optional); OpLab as a candidate
  second adapter. Greeks and IV are always computed by the engine.
- **AI**: `@anthropic-ai/sdk`. Opus for thesis/counter-thesis and strategy critique; Sonnet for
  routine reports. Prompts under `prompts/` with versions and fixture tests.
- **Hosting**: Vercel on the owner's Pro team (`feuxs-projects`), `*.vercel.app` domain. Pro is used for
  `maxDuration` on backtests and ingestion, never for per-minute crons (ADR-0010). Builds consume
  the team's included credit: keep preview builds lean.

Confirm with the owner before creating any paid resource or paid data subscription.

## Architecture principles

1. **AI never produces numbers.** The engine computes; the AI reasons over computed artifacts
   (payoff tables, backtest stats, greeks, risk metrics) and must cite the inputs it used. Output
   contract per analysis: thesis, counter-thesis, key risks, max loss, break-evens, invalidation
   conditions, confidence with justification.
2. **Strategies are data, not code.** Declarative definitions (JSON validated by Zod) → engine
   types → backtestable, diffable, versionable.
3. **Backtest hygiene is enforced by the engine, not by discipline**: no look-ahead, costs +
   slippage + B3 fees and taxes modeled, walk-forward validation, survivorship-bias awareness
   documented per dataset. An ADR records these rules.
4. **Decision journal**: every AI analysis and every decision a user records is stored with
   inputs, prompt version, model and timestamp, then scored against realized outcomes. The app
   must make each user's own track record visible.
5. **Tenant isolation is a hard invariant.** Every domain table carries `user_id`. Data access
   goes through user-scoped repositories that take the user from the session; no query path
   accepts an unscoped id. Every new table ships with an isolation test (user A cannot read or
   write user B). Reference data, the catalog and shared strategies (ADR-0012) are the only
   exceptions, read-only to users.
6. **LGPD by design**: terms and privacy policy accepted at registration; data minimization;
   account data export and deletion flows; audit log of access to portfolio and decision data.
   Ships before `REGISTRATION_MODE=open`.
7. **Deep modules, thin interfaces** (codebase-design vocabulary): `auth`, `market-data`,
   `engine`, `strategies`, `portfolio`, `decisions`. Each exposes a small entry point;
   implementation stays private.
8. **Domain docs are the source of truth**: `CONTEXT.md`, `UBIQUITOUS_LANGUAGE.md`, `docs/adr/`.
   Update them as decisions crystallize, not after.
9. **Validation at the edges**: Zod on every provider payload, strategy file, AI output and form.
   Types derive from schemas, never duplicated.
10. **Design is a gate**: `DESIGN.md` is canonical; UI tickets pass the Impeccable checks before
    done.

## Coding standards

- Pragmatic first: KISS and YAGNI beat cleverness. Build what the ticket asks; no speculative
  abstractions, feature flags or "future-proofing".
- SOLID where it earns its keep: small single-purpose modules; depend on interfaces only at real
  boundaries (data providers, AI client, email); extend through data (strategies, rules), not
  inheritance.
- DRY with judgment: extract on the third occurrence, or when two copies must change together.
  Duplication beats the wrong abstraction.
- **Comments: none by default.** Code says what; names say intent. A comment is allowed only for a
  _why_ that cannot live in code: a numeric edge case, a pricing-model assumption with its
  reference, a security invariant, a workaround with a link. No JSDoc that restates a signature.
  No commented-out code.
- Types over docs: Zod at the edges, derived types inside; no `any`; exhaustive `switch` on unions.
- Errors are typed values at boundaries; throw only where unrecoverable.
- `packages/engine` is pure: no side effects, deterministic given its inputs, seeded randomness
  only.
- Formatting and lint are machine-enforced (Prettier, ESLint strict, typescript-eslint). Reviewers
  never comment on what a tool enforces.
- Conventional commits, small commits, descriptive PRs. One PR per ticket, squash-merge.

## Testing

- **Unit**: Vitest on `packages/engine`: every indicator, pricing function, payoff and backtest
  rule, with reference values from standard texts as fixtures.
- **Property-based**: `fast-check` on pricing bounds, put-call parity, payoff symmetry,
  no-look-ahead invariants, decimal arithmetic.
- **Integration**: Route Handlers + Drizzle against the PR's Neon preview branch, including
  provider adapters with recorded fixtures.
- **Isolation**: for every user-scoped table, a test proving a session from user A cannot read,
  write or trigger jobs for user B. Mandatory, blocking.
- **E2E**: Playwright against the Vercel preview for the critical paths: registration, email
  verification, login, data ingestion trigger, candle chart, backtest run and report, payoff
  diagram, account deletion.
- Coverage gate on `packages/engine` (≥ 95% lines and branches); no gate on UI.
- A ticket is not done without tests that fail before the change and pass after: `/tdd` is
  mandatory for engine tickets, tests-alongside for UI.

## Review pipeline

Every PR runs `/review` (`.claude/commands/review.md`). It launches the reviewers below in
parallel. Each sees only its lens, the diff and the ticket, and returns findings that the
orchestrator merges into one checklist.

| reviewer     | model                    | lens                                                                                                                                                                                                       | blocking                               |
| ------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| correctness  | Opus                     | logic, edge cases, error handling, decimal math, race conditions                                                                                                                                           | yes                                    |
| quant        | Fable 5.1 / Opus         | pricing and greeks against references, backtest hygiene, statistical validity, look-ahead leaks                                                                                                            | yes (engine tickets)                   |
| security     | Fable 5.1 / Opus         | tenant isolation on every query and action, OWASP, authorization, secrets, injection, data exposure, rate limits, cron auth, dependency risk, LGPD obligations; runs the security-audit prompt on the diff | yes                                    |
| architecture | Fable 5.1 / Opus         | module boundaries, engine purity and frozen interface, coupling, YAGNI/KISS violations, ADR conformance                                                                                                    | yes                                    |
| spec         | Sonnet 5                 | does the change do what the ticket asked (`/code-review` Spec axis)                                                                                                                                        | yes                                    |
| standards    | Sonnet 5                 | coding standards above, naming, comments policy (`/code-review` Standards axis)                                                                                                                            | fix-forward; blocking only if repeated |
| context      | Sonnet 5                 | consistency with `CONTEXT.md`, glossary, ADRs and git history; flags decisions silently re-made                                                                                                            | advisory                               |
| external     | Codex CLI (`codex exec`) | independent second opinion on correctness                                                                                                                                                                  | advisory                               |

Rules: implementer and reviewer are never the same agent. A blocking finding returns the ticket to
the implementer with the finding as an acceptance criterion; the reviewer that raised it re-checks.
Findings are written to the PR.

## Agent routing

The main session is the orchestrator: it plans, delegates, integrates and talks to the owner. It
does not implement tickets itself. Subagents live in `.claude/agents/`, each with an explicit
`model`.

| agent                       | model                                  | responsibility                                                      |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| orchestrator (main session) | Fable 5.1 while quota lasts, else Opus | planning, delegation, integration, talking to the owner             |
| `architect`                 | Fable 5.1 / Opus                       | ADRs, module boundaries, grilling, interface design                 |
| `implementer`               | Sonnet 5, bounded thinking             | tickets, TDD loops, migrations                                      |
| `reviewer-correctness`      | Opus                                   | see review pipeline                                                 |
| `reviewer-quant`            | Fable 5.1 / Opus                       | see review pipeline                                                 |
| `reviewer-security`         | Fable 5.1 / Opus                       | see review pipeline                                                 |
| `reviewer-architecture`     | Fable 5.1 / Opus                       | see review pipeline                                                 |
| `reviewer-spec`             | Sonnet 5                               | see review pipeline                                                 |
| `reviewer-standards`        | Sonnet 5                               | see review pipeline                                                 |
| `reviewer-context`          | Sonnet 5                               | see review pipeline                                                 |
| `ui-critic`                 | Sonnet 5                               | Impeccable critique/fix loop on UI tickets                          |
| `scribe`                    | Haiku 4.5                              | docs, changelog, commit messages, i18n pass                         |
| `researcher`                | Haiku 4.5                              | docs lookup (Context7), data-provider API exploration, catalog seed |

Rules: pick the cheapest model that reliably does the task; escalate one tier only on failure and
say so. Prefer several small focused subagents over one long-running one. Independent tickets run
in parallel via background subagents. Record which agents handled each ticket in the PR.

## Design workflow

- `PRODUCT.md` + `DESIGN.md` exist before any UI is written. `/design` is used for the workstation
  shell and any new screen type, not for every ticket.
- Every UI ticket: implement → `npx impeccable detect` (must be clean) → `/impeccable critique` by
  the `ui-critic` agent → fix → repeat until the critique has no blocking findings.
- `/impeccable audit` belongs to the owner. Never run it for them.

## Design system tokens

Canonical values live in `DESIGN.md`; this is the summary `/design` and `/design-sync` read.

- Direction: dense, data-first workstation; dark by default; tabular monospaced numerals;
  hairlines, one action accent, a separate reserved color for risk. Not a fintech landing page.
- Structure (not themeable): header 48px with command search and market bar; left rail 200px /
  56px collapsed, six destinations; page = overline + headline + chips + actions; content grid
  `minmax(0,1fr) 320px`; hairline panels and table rows (height by `--density`), one decision
  bar per screen.
- Themes (per-user, `data-theme`, ADR-0015): `instrumento` (default) · `terminal` · `amplo`.
  Tokens: `--bg --surface --surface-2 --line --line-soft --ink --muted --faint --accent
--accent-hover --accent-ink --accent-soft --up --down --warning --danger --greek-delta
--greek-gamma --greek-theta --greek-vega --font-display --font-body --font-mono --radius
--elevation --density --chart-stroke`.
- Instrumento: bg `#0f1115`, surface `#151922`, ink `#e6e8ee`, muted `#8d97a8`, accent
  `#3fb8c8`, up `#2fb36a`, down `#e0524f`, warning `#e0a83a`, IBM Plex Sans + IBM Plex Mono,
  radius 4px, body 13px.
- Type scale (Instrumento): 11 · 12 · 13 · 15 · 18 · 22 · 26, scaled by the theme density factor
  (Terminal 0.95, Amplo 1.06); every number in `--font-mono` with tabular figures.
- Spacing 4px base, page padding 16px 20px, panel gap 14px; motion 120ms hover, 180ms shell;
  `prefers-reduced-motion` respected.
- Charts: candles `--up`/`--down`; payoff line `--chart-stroke` with gain/loss areas at 12%;
  greeks by their tokens; risk bands up/warning/down; never dual axes or pies.
- Formatting: `R$ 1.234,56`, `−R$ 1.234,56`, `2,08%`, `10,65% a.a.`, `17/10/2026`, `14:32`,
  `28 sessões`, `America/Sao_Paulo`.

## i18n

Source strings in English (`en`); pt-BR is the shipped locale. Every ticket that adds strings ends
with a `/better-portuguese` pass on the new pt-BR strings: natural, not literal. Currency, dates and
numbers follow Brazilian conventions. Same pipeline as Feudo so the two repos stay interchangeable.

## Working agreements

- Ask before: paid resources or data subscriptions, deleting data, force pushes, anything that
  would place or automate an order.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm db:check`, the Impeccable detect pass and
  `/review` must be green before any PR; engine coverage must not decrease.
- Full `/security-audit` (repo-wide, report + issues) after any ticket touching auth, tenancy or
  data access, before `REGISTRATION_MODE=open`, and monthly as a floor. Per-PR coverage is the
  security reviewer's job, not this command's.
- Product uncertainty → ask the owner. Technical uncertainty → one-paragraph ADR draft, then ask.
- Secrets: the owner pastes them into Vercel env. Never store them in the repo or in memory.

## Agent skills

### Issue tracker

GitHub Issues on `fernandolisboa/fetha` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `UBIQUITOUS_LANGUAGE.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
