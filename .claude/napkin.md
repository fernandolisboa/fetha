# Napkin Runbook

## Curation Rules

- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)

1. **[2026-09-02] Orchestrator never implements tickets**
   Do instead: delegate to `.claude/agents/implementer.md` (Sonnet); keep the main session for planning, integration and talking to the user. Phase 0 bootstrap is the one exception.
2. **[2026-09-02] Some claude.ai skills are user-only (`setup-matt-pocock-skills`, `setup-pre-commit`, `to-issues`, `to-prd`)**
   Do instead: replicate their output by hand (docs/agents/*, husky + lint-staged) and tell the user at the next checkpoint.
3. **[2026-09-02] Sibling repo `../feudo` is the template ("same as Feudo")**
   Do instead: mirror its versions, configs and agent shapes; deviate only where the kickoff says so (engine package, contracts package, quant reviewer, decimal prices).

## Shell & Command Reliability

1. **[2026-09-02] Toolchain: node 24, pnpm 10.31, gh (fernandolisboa), vercel CLI (fernandoigorlisboa-8569), codex 0.152 works in WSL**
   Do instead: no Neon CLI; Neon goes through the Vercel integration.
2. **[2026-09-02] `cd` in Bash resets cwd after the call**
   Do instead: use absolute paths or `cd ../feudo && ...` in a single command.

## Domain Behavior Guardrails

1. **[2026-09-02] Multi-user; the user account is the tenant**
   Do instead: every domain table carries `user_id`; user-scoped repositories; isolation test per table. Market data + strategy catalog are shared read-only reference data.
2. **[2026-09-02] Prices are decimals, money is integer centavos, never JS `number` for money**
   Do instead: `decimal.js` / Drizzle `numeric` for prices; integer centavos for money.
3. **[2026-09-02] AI never produces numbers; engine is pure**
   Do instead: engine computes, AI reasons over artifacts and cites inputs; `packages/engine` has zero I/O.

## User Directives

1. **[2026-09-02] Speak pt-BR to the user; everything else in English**
   Do instead: chat in Portuguese; code, commits, tickets, docs, ADRs in English; UI strings ship in pt-BR.
2. **[2026-09-02] Stop at every ⏸ checkpoint and wait for approval**
   Do instead: finish the phase, present the requested artifacts, end the turn.
3. **[2026-09-02] Ask before paid resources/data subscriptions, deleting data, force pushes, anything placing or automating an order**
   Do instead: state cost/impact and wait.
4. **[2026-09-02] User does not read code; reviewers and tests are their eyes**
   Do instead: optimize for verifiability; never run `/impeccable audit` for the user.
