# Napkin Runbook

## Curation Rules

- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)

1. **[2026-09-02] Orchestrator never implements tickets**
   Do instead: delegate to `.claude/agents/implementer.md` (Sonnet); keep the main session for planning, integration and talking to the user. Phase 0 bootstrap is the one exception.
2. **[2026-09-02] Some claude.ai skills are user-only (`setup-matt-pocock-skills`, `setup-pre-commit`, `grill-with-docs`, `to-issues`, `to-prd`, `design-an-interface`)**
   Do instead: ask the user to type the slash command with the arguments ready to paste; never replicate `grill-with-docs` by other means (the harness forbids it).
3. **[2026-09-02] Sibling repo `../feudo` is the template ("same as Feudo")**
   Do instead: mirror its versions, configs and agent shapes; deviate only where the kickoff says so (engine package, contracts package, quant reviewer, decimal prices).

4. **[2026-09-09] `design-an-interface` does not exist in the plugin; use `mattpocock-skills:codebase-design` (DESIGN-IT-TWICE.md) with 3 parallel `architect` agents. Owner wants Fable 5.1 for design-grade work**
   Do instead: brief each architect with a different constraint (minimal / flexible / common caller), write to `docs/design/<module>/`, compare, then publish a pt-BR decision page as an Artifact so the owner can choose without reading code. Never downgrade `architect` or a blocking reviewer for cost without asking; when Fable credits run out mid-run the agent fails with a 429 — relaunch with `model: opus` and say so.
5. **[2026-09-11] An implementer builds to your instruction exactly, including the parts that are wrong**
   Do instead: state the _reason_ alongside the instruction so the implementer can notice when it does not hold, and have the lens that owns the area re-check your instruction and not only the code. Four of my own instructions were wrong in one session — an EMA error estimate, wiring note codes the engine never emits, choosing a by-value enum mirror over a derived one, and asking for a parity test case that saturated and could never fail. Reviewers caught all four; post the correction in the next checklist and say plainly it was yours. When an agent's report states a _rationale_ ("a Zod inference quirk", "pre-existing"), have the reviewer verify it by compiling or reproducing — two such rationales were false this session.
6. **[2026-09-09] Review batching works: collect all lenses, send one consolidated fix brief to the author agent, then re-check only the blocking lens**
   Do instead: number the items, mark blocking vs advisory, require gate outputs and ADR-block == code confirmation in the report.

7. **[2026-09-11] An E2E spec that leaves a form field unset silently inherits whatever the shared catalog holds, so it is green only by accident**
   Do instead: have every spec state every field its assertion depends on — `signals.spec.ts` and `strategies.spec.ts` never chose a **Estrutura** and broke the moment the seeded catalog grew and `structures[0]` (ordered by name) became `Collar`, which cannot submit with an empty strike list. When a query is ambiguous, give the element an accessible name and scope to it (`getByRole("table", { name: "Caixa de entrada" })`); never reach for `.first()`, which stays green when the row it should prove is gone. Watch substring matches too — three specs failed this way in one day: `getByText("Entrada")` also matched "custo da entrada", `getByLabel("De")` matched "Modelo de custos", and `getByText("Watchlist")` matched the overline, the `h1` and Next's `#__next-route-announcer__`. **And run the whole suite, not the specs for your own ticket**, whenever a PR touches the shell or any shared layout: #77 merged green on four specs and left `shell.spec.ts` broken on `main` (#93).

8. **[2026-09-09] The shell's global `TEST_DATABASE_URL` belongs to Feudo's test database, not to Fetha**
   Do instead: never let an agent export it as `DATABASE_URL`; local integration tests use `apps/web/.env.local` from `vercel link` + `vercel env pull --environment=preview` (host `ep-lively-mode-awapxaoj`, the `fetha-preview` project); tell every implementer and reviewer explicitly; since #49, `test:integration`, `vitest --config vitest.integration.config.mts`, `db:migrate`, `db:reset` and both seed scripts refuse any host but `fetha-preview` (production needs `ALLOW_PRODUCTION_DATABASE=1`) before any query, and read `apps/web/.env.local` over the shell; never set `ALLOW_DISPOSABLE_DATABASE=1` to get past that refusal. Two implementers (#11, #12) migrated Fetha tables into Feudo's test DB before this was caught.
9. **[2026-09-09] Two parallel tickets both generated `drizzle/0001_*`**
   Do instead: whichever merges second rebases, deletes its migration and regenerates it as the next number with `pnpm db:generate` (never renumber by hand); check `drizzle/meta/_journal.json` before opening the PR.

10. **[2026-09-10] Engine branch reshaping a shared internal module (e.g. `price-operation.ts` exports) while a sibling branch imports those exports creates reconciliation conflict**
    Do instead: decide the merge order up front, merge the more advanced branch first, put reconciliation in the other branch's next fix round rather than stacking PRs.

## Shell & Command Reliability

0. **[2026-09-18] `import/no-restricted-paths` with a glob `from` (`./src/modules/*`) matches nothing: minimatch runs against the resolved file path and `*` never crosses `/`, and a glob `from` demands glob `except` entries too**
   Do instead: generate one literal `from: ./src/modules/<m>` zone per module (as `apps/web/eslint.config.mjs` does) and prove every zone with throwaway probe files that must error and must pass; four reviewers plus Codex caught this in #96 after the implementer had only probed the cross-module zones.

1. **[2026-09-09] Vercel runs the Ignored Build Step inside the Root Directory (`apps/web`) with no access to `..`, clones single-branch shallow, and all three env tiers point at the Neon main branch until preview branches are enabled**
   Do instead: keep `ignoreCommand` in `apps/web/vercel.json` pointing inside `apps/web`; the first deployment of a branch always builds (Vercel's clone cannot fetch `main` of a private repo, so no base exists), later pushes use `VERCEL_GIT_PREVIOUS_SHA`; never point CI tests at the Vercel `DATABASE_URL` (ask the owner for a Neon `ci` branch); after `main` advances, `gh pr update-branch <n>` before merging (strict protection); run `pnpm install` in the main checkout after merging a PR that adds dependencies.

2. **[2026-09-09] `gh pr checks --watch` returns "no checks" if the CI run has not registered yet, and the merge then bypasses protection**
   Do instead: after pushing, loop `gh run list --branch <b> --limit 1` until a run exists, `gh run watch <id> --exit-status`, and only merge when `gh pr checks <n>` lists `ci pass`. `enforce_admins` is on since 2026-09-09.

3. **[2026-09-11] The session scratchpad under `/tmp/claude-1000/...` can be wiped between sessions, taking the worktrees and the pulled preview env with it**
   Do instead: on resuming, check the scratchpad exists before trusting anything in it — `git worktree list` shows the old ones as `prunable`. Rebuild with `git worktree prune` + `git worktree add`, `pnpm install`, and `vercel env pull <sp>/env/preview.env --environment=preview`. Values marked sensitive come back masked and are unrecoverable: rotate them in one call with `PATCH https://api.vercel.com/v9/projects/<projectId>/env/<envId>?teamId=...` (find `envId` via `GET .../env?decrypt=true`) using the token in `~/.local/share/com.vercel.cli/auth.json`, then `vercel redeploy <preview-url>`. The Deployment Protection bypass token is readable — it is the key of the `protectionBypass` map in `GET /v9/projects/<projectId>`. Never print any of these values.

4. **[2026-09-02] Toolchain: node 24, pnpm 10.31, gh (fernandolisboa), vercel CLI (fernandoigorlisboa-8569), codex 0.152 works in WSL**
   Do instead: no Neon CLI; Neon is the Vercel marketplace resource `neon-cinereous-ocean` (Free plan `free_v3`, no card) on project `fetha` (team `feuxs-projects`); env vars (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, ...) are synced by the integration. Prod URL: https://fetha.vercel.app.
5. **[2026-09-02] GitHub push: no SSH key in WSL and the `gh` OAuth token lacks the `workflow` scope**
   Do instead: remote is HTTPS via `gh auth setup-git`; the owner must run `gh auth refresh -h github.com -s workflow` once before any push that touches `.github/workflows`.
6. **[2026-09-02] Vercel root directory has no CLI flag**
   Do instead: PATCH `https://api.vercel.com/v9/projects/fetha?teamId=team_GXogSV1DlEUaBKFFJz96kEmP` with the token from `~/.local/share/com.vercel.cli/auth.json` (never print it).
7. **[2026-09-02] `npx impeccable install` fails ("invalid zip data")**
   Do instead: copy `.claude/skills/impeccable` and the `impeccable-*` agents from `../feudo` (v4.1.3).
8. **[2026-09-02] `cd` in Bash resets cwd after the call**
   Do instead: use absolute paths or `cd ../feudo && ...` in a single command.

9. **[2026-09-10] CI `integration` jobs share the `preview-db` concurrency group with `cancel-in-progress: false`; GitHub keeps at most one pending job per group**
   Do instead: when several branches push at once the older pending job is cancelled (shows as `cancelled`, not failed); rerun the run once the queue is quiet, and expect this whenever more than one implementer pushes.

## Domain Behavior Guardrails

0. **[2026-09-18] Vertical slices (ADR-0019): a module owns its tables under `modules/<m>/schema(.ts|/)`, and code outside a module may import only `@/modules/<m>`, `/client` or `/schema` (ESLint `import/no-restricted-paths`; `*.integration.test.ts` and `src/db/test/**` exempt). Accepted ADRs are never edited, so a move puts an old→new path map in the new ADR**
   Do instead: a new module ships `schema`, `index.ts`, optional `client.ts`, one line in `src/db/schema.ts`, one lint zone and a row in `ARCHITECTURE.md`; schema files use relative imports only (drizzle-kit and the `.mjs` scripts load them without `@/`); prove "no SQL change" with `db:check` plus a clean `db:generate`. This is the one structural divergence from Feudo (which keeps `db/schema` central).

1. **[2026-09-09] Drizzle migrations are matched by journal timestamp: squashing/regenerating a migration after it ran anywhere (production got the old `0000` from early previews) makes `db:migrate` recreate tables and fail**
   Do instead: never regenerate an applied migration; before the first real user, an empty production schema may be reset by hand (`drop schema public cascade; create schema public; drop schema drizzle cascade`) and the `migrate-production` workflow rerun; afterwards only additive migrations (expand/contract, ADR-0016).

2. **[2026-09-09] A PR with merge conflicts gets NO GitHub Actions run (no check suite at all); Better Auth's `nextCookies` plugin skips `auth.handler()` calls (router mode), so server actions must forward `Set-Cookie` themselves; Vercel previews sit behind SSO, sensitive env vars cannot be read back, and E2E needs `x-vercel-protection-bypass` plus market data ingestion**
   Do instead: when a PR shows zero runs, check `mergeable` first and `gh pr update-branch`; keep the cookie-forwarding helper and its integration test; sensitive env vars (`E2E_SECRET`, `CRON_SECRET`) are unreadable and must be rotated — see Shell & Command Reliability item 2; for E2E, run from scratch worktree with `PLAYWRIGHT_BASE_URL`, `E2E_SECRET`, `VERCEL_PROTECTION_BYPASS` (preview has `REGISTRATION_MODE=open`); every CI reset clears `fetha-preview`, so E2E tests needing market data (watchlist, chart, backtest, signals) must first ingest one closed session via `POST /api/cron/ingest` with bearer + `x-vercel-protection-bypass` header, payload `{"session":"YYYY-MM-DD"}` (~1 min), then migrate — expect data to vanish on next CI run.

3. **[2026-09-10] Three parallel implementers sharing `fetha-preview` database may race on migrations and table creation; CI runs `pnpm --filter @fetha/web run db:reset` before migrating so integration jobs always start clean, but local runs go against `fetha-preview` carrying state from every agent, so tests that pass locally may fail in CI — not flaky, but real (relying on rows earlier runs left)**
   Do instead: wrap every DB-touching command in `flock <scratchpad>/env/preview-db.lock`, migrate right before each integration run; before declaring an integration suite green, reproduce CI's own sequence under one flock hold — `db:reset`, then `db:migrate`, then the tests — rather than running against whatever state the shared database holds. Stray tables from sibling branches are expected and cleaned on the next `db:migrate`.

4. **[2026-09-02] Multi-user; the user account is the tenant**
   Do instead: every domain table carries `user_id`; user-scoped repositories; isolation test per table. Market data + strategy catalog are shared read-only reference data.
5. **[2026-09-02] Prices are decimals, money is integer centavos, never JS `number` for money**
   Do instead: `decimal.js` / Drizzle `numeric` for prices; integer centavos for money.
6. **[2026-09-02] AI never produces numbers; engine is pure**
   Do instead: engine computes, AI reasons over artifacts and cites inputs; `packages/engine` has zero I/O.

## User Directives

0. **[2026-09-02] Owner pays Vercel Pro but GitHub Actions minutes are scarce and Vercel build credit is shared with other projects**
   Do instead: keep CI to one lean job; never add scheduled workflows; no per-minute crons; skip Vercel builds on docs-only changes when possible.

1. **[2026-09-02] Speak pt-BR to the user; everything else in English**
   Do instead: chat in Portuguese; code, commits, tickets, docs, ADRs in English; UI strings ship in pt-BR.
2. **[2026-09-02] Stop at every ⏸ checkpoint and wait for approval**
   Do instead: finish the phase, present the requested artifacts, end the turn.
3. **[2026-09-02] Ask before paid resources/data subscriptions, deleting data, force pushes, anything placing or automating an order**
   Do instead: state cost/impact and wait.
4. **[2026-09-02] User does not read code; reviewers and tests are their eyes**
   Do instead: optimize for verifiability; never run `/impeccable audit` for the user.
5. **[2026-09-18] Owner wants a layout readable feature by feature, without over-engineering: vertical slices inside the one Next.js app, no `apps/api`, no package per feature, no `apps/web` rename for now**
   Do instead: keep `app/` as thin transport and put everything else in `modules/<m>/`; never propose a folder per strategy (strategies are data, ADR-0008); if `strategies` grows, `signals` is the sanctioned next split.
