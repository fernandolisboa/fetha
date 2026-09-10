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

4. **[2026-09-09] `design-an-interface` does not exist in the plugin; use `mattpocock-skills:codebase-design` (DESIGN-IT-TWICE.md) with 3 parallel `architect` agents**
   Do instead: brief each architect with a different constraint (minimal / flexible / common caller), write to `docs/design/<module>/`, compare, then publish a pt-BR decision page as an Artifact so the owner can choose without reading code.
5. **[2026-09-09] Owner wants Fable 5.1 for design-grade work; Opus only where the routing table says so**
   Do instead: never downgrade `architect` or blocking reviewers for cost without asking.
6. **[2026-09-09] Review batching works: collect all lenses, send one consolidated fix brief to the author agent, then re-check only the blocking lens**
   Do instead: number the items, mark blocking vs advisory, require gate outputs and ADR-block == code confirmation in the report.

7. **[2026-09-09] The shell's global `TEST_DATABASE_URL` belongs to Feudo's test database, not to Fetha**
   Do instead: never let an agent export it as `DATABASE_URL`; local integration tests use `apps/web/.env.local` from `vercel link` + `vercel env pull --environment=preview` (host `ep-lively-mode-awapxaoj`, the `fetha-preview` project); tell every implementer and reviewer explicitly; guard tracked in #49. Two implementers (#11, #12) migrated Fetha tables into Feudo's test DB before this was caught.
8. **[2026-09-09] Two parallel tickets both generated `drizzle/0001_*`**
   Do instead: whichever merges second rebases, deletes its migration and regenerates it as the next number with `pnpm db:generate` (never renumber by hand); check `drizzle/meta/_journal.json` before opening the PR.

9. **[2026-09-10] Engine branch reshaping a shared internal module (e.g. `price-operation.ts` exports) while a sibling branch imports those exports creates reconciliation conflict**
   Do instead: decide the merge order up front, merge the more advanced branch first, put reconciliation in the other branch's next fix round rather than stacking PRs.

## Shell & Command Reliability

0. **[2026-09-09] Vercel runs the Ignored Build Step inside the Root Directory (`apps/web`) with no access to `..`, clones single-branch shallow, and all three env tiers point at the Neon main branch until preview branches are enabled**
   Do instead: keep `ignoreCommand` in `apps/web/vercel.json` pointing inside `apps/web`; the first deployment of a branch always builds (Vercel's clone cannot fetch `main` of a private repo, so no base exists), later pushes use `VERCEL_GIT_PREVIOUS_SHA`; never point CI tests at the Vercel `DATABASE_URL` (ask the owner for a Neon `ci` branch); after `main` advances, `gh pr update-branch <n>` before merging (strict protection); run `pnpm install` in the main checkout after merging a PR that adds dependencies.

1. **[2026-09-09] `gh pr checks --watch` returns "no checks" if the CI run has not registered yet, and the merge then bypasses protection**
   Do instead: after pushing, loop `gh run list --branch <b> --limit 1` until a run exists, `gh run watch <id> --exit-status`, and only merge when `gh pr checks <n>` lists `ci pass`. `enforce_admins` is on since 2026-09-09.

2. **[2026-09-02] Toolchain: node 24, pnpm 10.31, gh (fernandolisboa), vercel CLI (fernandoigorlisboa-8569), codex 0.152 works in WSL**
   Do instead: no Neon CLI; Neon is the Vercel marketplace resource `neon-cinereous-ocean` (Free plan `free_v3`, no card) on project `fetha` (team `feuxs-projects`); env vars (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, ...) are synced by the integration. Prod URL: https://fetha.vercel.app.
3. **[2026-09-02] GitHub push: no SSH key in WSL and the `gh` OAuth token lacks the `workflow` scope**
   Do instead: remote is HTTPS via `gh auth setup-git`; the owner must run `gh auth refresh -h github.com -s workflow` once before any push that touches `.github/workflows`.
4. **[2026-09-02] Vercel root directory has no CLI flag**
   Do instead: PATCH `https://api.vercel.com/v9/projects/fetha?teamId=team_GXogSV1DlEUaBKFFJz96kEmP` with the token from `~/.local/share/com.vercel.cli/auth.json` (never print it).
5. **[2026-09-02] `npx impeccable install` fails ("invalid zip data")**
   Do instead: copy `.claude/skills/impeccable` and the `impeccable-*` agents from `../feudo` (v4.1.3).
6. **[2026-09-02] `cd` in Bash resets cwd after the call**
   Do instead: use absolute paths or `cd ../feudo && ...` in a single command.

7. **[2026-09-10] CI `integration` jobs share the `preview-db` concurrency group with `cancel-in-progress: false`; GitHub keeps at most one pending job per group**
   Do instead: when several branches push at once the older pending job is cancelled (shows as `cancelled`, not failed); rerun the run once the queue is quiet, and expect this whenever more than one implementer pushes.

## Domain Behavior Guardrails

0. **[2026-09-09] Drizzle migrations are matched by journal timestamp: squashing/regenerating a migration after it ran anywhere (production got the old `0000` from early previews) makes `db:migrate` recreate tables and fail**
   Do instead: never regenerate an applied migration; before the first real user, an empty production schema may be reset by hand (`drop schema public cascade; create schema public; drop schema drizzle cascade`) and the `migrate-production` workflow rerun; afterwards only additive migrations (expand/contract, ADR-0016).

1. **[2026-09-09] A PR with merge conflicts gets NO GitHub Actions run (no check suite at all); Better Auth's `nextCookies` plugin skips `auth.handler()` calls (router mode), so server actions must forward `Set-Cookie` themselves; Vercel previews sit behind SSO, Playwright needs `x-vercel-protection-bypass` (project bypass secret, scratchpad `env/e2e.env`)**
   Do instead: when a PR shows zero runs, check `mergeable` first and `gh pr update-branch`; keep the cookie-forwarding helper and its integration test; run E2E from a scratch worktree with `PLAYWRIGHT_BASE_URL`, `E2E_SECRET`, `VERCEL_PROTECTION_BYPASS` (preview env has `REGISTRATION_MODE=open`).

2. **[2026-09-02] Multi-user; the user account is the tenant**
   Do instead: every domain table carries `user_id`; user-scoped repositories; isolation test per table. Market data + strategy catalog are shared read-only reference data.
3. **[2026-09-02] Prices are decimals, money is integer centavos, never JS `number` for money**
   Do instead: `decimal.js` / Drizzle `numeric` for prices; integer centavos for money.
4. **[2026-09-02] AI never produces numbers; engine is pure**
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
