---
description: Run the Fetha review pipeline on a diff — parallel reviewers, one merged checklist
argument-hint: [base-ref] [ticket-url-or-number]
---

Review the changes since `$1` (default: merge-base with `main`) for ticket `$2` (default: the issue linked in the branch name or the latest commit message).

## Setup

1. Compute the diff: `git diff <base>...HEAD` plus untracked files. Fetch the ticket body with `gh issue view <n>` when a number is given.
2. Write the diff and the ticket to the scratchpad so every reviewer reads the same input.
3. Classify the ticket: it is an **engine ticket** when the diff touches `packages/engine` or the issue carries the `engine` label.

## Launch reviewers in parallel

Use the Agent tool, one call per reviewer, all in the same message. Each agent receives only: its lens (from its definition in `.claude/agents/`), the diff path, the ticket path, and the instruction to return a checklist.

| agent                   | blocking                                  |
| ----------------------- | ----------------------------------------- |
| `reviewer-correctness`  | yes                                       |
| `reviewer-quant`        | yes on engine tickets; advisory otherwise |
| `reviewer-security`     | yes                                       |
| `reviewer-architecture` | yes                                       |
| `reviewer-spec`         | yes                                       |
| `reviewer-standards`    | fix-forward; blocking only if repeated    |
| `reviewer-context`      | advisory                                  |

External second opinion: if `codex` runs in this shell (`command -v codex && codex --version`), run
`codex exec "Review this diff for correctness bugs only. Report file:line, defect, failure scenario." < <diff-path>`
and treat its output as an ADVISORY reviewer. If it does not run, record "external: skipped (codex unavailable)" and continue.

## Merge

Produce one checklist grouped by severity: BLOCKING first, then ADVISORY. De-duplicate findings raised by several lenses, keeping the strictest label and naming every lens that raised it. Each item: `file:line`, defect, failure scenario, suggested fix, raising lens(es).

Verdict:

- Any BLOCKING item → **RETURN**: the ticket goes back to the implementer with each blocking finding as an acceptance criterion. The lens that raised it re-checks after the fix.
- No BLOCKING item → **PASS**; advisory items become follow-up notes in the PR.

## Record

When a PR exists for the branch, post the merged checklist as a PR comment (`gh pr comment`). Otherwise print it. List which agents handled the ticket (implementer and reviewers) for the PR description.

Rules: implementer and reviewer are never the same agent. Reviewers never fix code.
