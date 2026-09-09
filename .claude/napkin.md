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

## Shell & Command Reliability

1. **[2026-09-02] Toolchain: node 24, pnpm 10.31, gh (fernandolisboa), vercel CLI (fernandoigorlisboa-8569), codex 0.152 works in WSL**
   Do instead: no Neon CLI; Neon is the Vercel marketplace resource `neon-cinereous-ocean` (Free plan `free_v3`, no card) on project `fetha` (team `feuxs-projects`); env vars (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, ...) are synced by the integration. Prod URL: https://fetha.vercel.app.
2. **[2026-09-02] GitHub push: no SSH key in WSL and the `gh` OAuth token lacks the `workflow` scope**
   Do instead: remote is HTTPS via `gh auth setup-git`; the owner must run `gh auth refresh -h github.com -s workflow` once before any push that touches `.github/workflows`.
3. **[2026-09-02] Vercel root directory has no CLI flag**
   Do instead: PATCH `https://api.vercel.com/v9/projects/fetha?teamId=team_GXogSV1DlEUaBKFFJz96kEmP` with the token from `~/.local/share/com.vercel.cli/auth.json` (never print it).
4. **[2026-09-02] `npx impeccable install` fails ("invalid zip data")**
   Do instead: copy `.claude/skills/impeccable` and the `impeccable-*` agents from `../feudo` (v4.1.3).
5. **[2026-09-02] `cd` in Bash resets cwd after the call**
   Do instead: use absolute paths or `cd ../feudo && ...` in a single command.

## Domain Behavior Guardrails

1. **[2026-09-02] Multi-user; the user account is the tenant**
   Do instead: every domain table carries `user_id`; user-scoped repositories; isolation test per table. Market data + strategy catalog are shared read-only reference data.
2. **[2026-09-02] Prices are decimals, money is integer centavos, never JS `number` for money**
   Do instead: `decimal.js` / Drizzle `numeric` for prices; integer centavos for money.
3. **[2026-09-02] AI never produces numbers; engine is pure**
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
