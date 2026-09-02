---
description: Full security audit — verified findings only, versioned Markdown report and triage-ready GitHub issues
argument-hint: [full | since <git-ref> | <path>] [--pdf]
---

Audit this codebase for security flaws. Scope: `$ARGUMENTS` (default: `full`). `since <git-ref>` limits the audit to files changed since that ref; a path limits it to that subtree. `--pdf` additionally renders the report as PDF.

Write the report and the issues in Portuguese (pt-BR). Keep code, identifiers, file paths and labels as they are.

## Step 0 — Detect the stack

Before auditing, identify and record: language and framework; ORM or query builder; auth mechanism and session model; the tenancy/isolation mechanism (RLS, tenant middleware, scoped repositories, manual `user_id`/`household_id` filters); frontend and rendering model; AI/LLM integrations and where prompts are assembled; external data providers and how they are called; background jobs, cron and webhooks; deploy artifacts (CI workflows, platform config, Docker, IaC). Map every category below to this stack's equivalent and state the mapping in the report's methodology note.

## Categories

1. **Tenant isolation** — list, search, aggregate, report and export queries that do not filter by the authenticated user or their tenant (household/workspace). Identify the project's isolation mechanism first, then point to where it is absent or bypassed, including background jobs and cron handlers that run without a tenant in scope.
2. **Authorization decided in the browser** — privileged operations (admin, settings, member management, any write) where the frontend hides UI by role but the server does not enforce the equivalent check. Cross every frontend role gate with its endpoint or server action and confirm the backend validates the privilege on every sensitive route.
3. **IDOR** — routes and server actions that read, update or delete an object by id (path, query or body) without verifying the object belongs to the caller's user/tenant. Walk every handler and every server action systematically, not a sample.
4. **Exposed secrets** — API keys, tokens, signing secrets (JWT, webhooks, cron bearer), private keys and default credentials in source, configs, CI, scripts and docs. Watch for public defaults that become real secrets when not overridden (`${VAR:-default}`) and for missing startup validation that rejects them. Check git history for committed secrets and the client bundle for embedded keys.
5. **Untreated input (XSS)** — `dangerouslySetInnerHTML` and equivalents, markdown/HTML rendering without sanitization, user-controlled URLs in `href`/`src` (`javascript:`), `eval`/`new Function`; on the server, user input reaching email HTML, templates or responses without escaping. Check whether a sanitization library exists and whether it is applied at every point found.
6. **Prompt injection and AI output handling** — any user- or third-party-controlled text reaching an LLM prompt: transaction descriptions, merchant and bank names, imported files, provider payloads, free-text fields. Check that such data is delimited and treated as data, that AI output is never rendered as HTML, never executed, and never used to trigger actions without validation, and that AI outputs are validated against a schema before storage.
7. **Unauthenticated or abusable endpoints** — cron, webhook, sync-trigger and AI endpoints without authentication or rate limiting; auth endpoints without brute-force protection; SSRF in server-side fetches to data providers (user-influenced URLs, redirects).
8. **Sensitive data handling** — bank connection tokens, PII and financial data at rest (encryption), in logs and error messages, in analytics; exports that leak other tenants' data; account and tenant deletion that leaves data behind; retention beyond need.
9. **Dependencies and supply chain** — known vulnerabilities (`pnpm audit` or the stack's equivalent), lockfile integrity, unpinned or mutable CI actions, postinstall scripts from untrusted packages.

## Rules

- Report only findings verified in the actual code. No speculation. For each finding: file path, exact line number(s), the code excerpt, why it is exploitable, and severity (critical / high / medium / low / informational).
- List file by file, line by line.
- Also record what was checked and is **correct** (e.g. "every handler in `ledger/` validates household ownership") — this becomes the strengths section and proves coverage.
- When a category does not apply to this stack, say so explicitly instead of forcing findings.
- Note exploitability conditions (feature flags, insecure config required, specific `REGISTRATION_MODE`, etc.).
- Before creating issues, search open issues labeled `security` and skip or reference duplicates.

## Deliverables

1. **Report** at `docs/security-audit/YYYY-MM-DD.md` (today's date), containing:
   - Cover: "Relatório de Auditoria de Segurança — <project name>", date, audited scope, methodology note (how each category was mapped to the detected stack).
   - Executive summary: totals by severity and by category (tables; charts only in the PDF variant).
   - Strengths (what is protected, with evidence) and weaknesses (the central risks).
   - Detailed findings table per category: Severity | File:line | Description.
   - Prioritized recommendations (P1, P2, P3...).
   - Group trivial related findings (e.g. several secret defaults on the same theme) to avoid noise.
2. **GitHub issues** — for each actionable finding or group, `gh issue create` with:
   - Title: `[Segurança] <short description>`
   - Labels: `security`, `severity:<level>`, `needs-triage`
   - Body: problem and why it is exploitable; evidence (file:line with excerpt); impact; suggested fix; acceptance criteria as a verifiable checklist.
     Link each issue in the report's findings table.
3. **In chat**: the findings list file by file, line by line, and the paths of every generated file.

## PDF variant (`--pdf` only)

Do not install anything globally. Use an isolated Python venv with `reportlab` + `matplotlib` (or a headless browser / pandoc if already available). Keep the generator script in `docs/security-audit/` so the report can be regenerated. A4, ~2 cm margins, header and footer with report name and page number. Executive summary gets a donut chart by severity and a bar chart by category — palette: critical `#B91C1C`, high `#EA580C`, medium `#D97706`, low `#2563EB`, strength `#059669`. Rasterize the pages and verify page count, chart rendering and table legibility; fix visual defects before delivering. Output: `docs/security-audit/YYYY-MM-DD.pdf`.
