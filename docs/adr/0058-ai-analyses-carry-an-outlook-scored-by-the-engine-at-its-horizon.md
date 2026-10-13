---
status: accepted
date: 2026-10-13
---

# AI analyses carry an outlook, scored by the engine at its horizon (#292, amends 0057, restores 0005)

## Context

ADR-0005 and ADR-0009 say every AI analysis is scored like a decision. ADR-0057 deferred that,
because the analysis contract (`analysis@1`) carries no horizon and no machine-checkable claim:
thesis and counter-thesis are prose, and confidence (`low`, `medium`, `high`) grades how well the
facts support a view, not how likely an outcome is. A score needs three things the engine already
knows how to use (ADR-0014 Q36, Q46, Q54): a thesis claim from the closed vocabulary, a horizon
session, and a confidence in [0, 1]. ADR-0057's own rule still holds: the model never writes a
number the inputs do not hold, and never produces a number at all for something it is asked to
judge.

## Decision

**Outlook.** A new prompt version, `analysis@2`, adds one field to the output contract
(`analysisOutputV2Schema` in `packages/contracts`): `outlook`, either `null` or

- `instrumentFact`: the subject's own ticker, `"underlying"` for an operation or `"ticker"` for a
  signal;
- `direction`: `above` or `below`;
- `levelFact`: the dot path of a per-share price of that ticker in the subject's pricing: its spot,
  a break-even or a payoff point (`"pricing.spot"`, `"pricing.breakEvens.0"`,
  `"pricing.payoff.3.underlying"`, under `"proposal."` for a signal);
- `horizon`: `one_week`, `one_month`, `three_months` or `expiry`;
- `likelihood`: `somewhat_likely`, `likely` or `very_likely`.

The model names facts by path and picks words from closed lists; it writes no figure. The app
turns the outlook into the engine's `ThesisClaim` (`close_above` or `close_below` the level, read
from the fact as a decimal) with `resolveAnalysisOutlook`, a pure function next to the citation
check. `outlook: null` is allowed: a critique with no verifiable claim (most backtest runs) is
stored and shown with "no verifiable claim", never as held or failed (ADR-0014 Q36).

**What is rejected.** An `analysis@2` reply is `rejected` (counted toward the cap, ADR-0057) when
its outlook names an instrument path other than the subject's own ticker, a level path other than
a spot, break-even or payoff point, or one that holds no positive price in `R$` (a money amount
such as the max gain, or an option premium, is written in reais too but is no level for the
underlying and would make the claim hold trivially), or
`expiry` when the facts have no `expiry` date after their own `session`. The reason is stored as
`{ kind: "outlook", problem }`. `operation_pnl_positive` is not offered: an analysis stores
formatted facts, not an engine `Operation`, and rebuilding one would score the user's later fills
rather than the analysis's judgment; a close above or below a break-even states the same thing
for a single-expiry structure.

**Confidence.** The likelihood maps to the claim's confidence by a fixed table in
`packages/contracts` (`analysisLikelihoodConfidence`): `somewhat_likely` 0.60, `likely` 0.75,
`very_likely` 0.90. The model always states the outcome it finds more likely than not (a claim
below 0.5 is the opposite claim above it), so the table starts above even odds. The confidence
level of `analysis@1` keeps its meaning (support in the facts) and is not used for scoring.

**Horizon.** Resolved once, when the reply is accepted, against the trading calendar (ingested
through the end of next year, ADR-0017): the anchor is the latest session closed at the request
instant; `one_week`, `one_month` and `three_months` are the 5th, 21st and 63rd sessions after it;
`expiry` is the first session on or after the `expiry` fact. If the calendar cannot place it, or
the session found already closed at the request instant (a stale `expiry` fact; scoring it would
look ahead, ADR-0014 Q54), the analysis is still accepted (its prose passed every check) but stores no claim, and the journal
says its outlook could not be dated.

**Storage.** `analysis_results` gains three nullable columns written in the same insert as the
row (append-only is unchanged): `claim` (a `close_above` or `close_below` `ThesisClaim`), `claim_confidence` and `horizon`.
They are all set or all null, and only on `accepted` rows (check constraint). A new
`analysis_scores` table mirrors `decision_scores`: one append-only row per request, user-scoped
with a composite foreign key `(request_id, user_id)` to `analysis_requests`, holding the engine's
`Score` or an `unscorable_reason`, plus `claim_held` and `brier` for aggregation, and the engine
version. It joins the account export and the account deletion cascade.

**Scoring.** The nightly job scores analyses right after decisions, with the same as-of session,
the same deadline and the same rules (ADR-0014 Q54): `decisions/analysis-scoring-service.ts`
calls the engine's `score` with `subject: "analysis"`, `decidedAt` = the request instant, no
operation and no fills, so the engine scores the claim alone (Q46): `held` on the nominal D1
close at the horizon session, Brier against the mapped confidence. `insufficient_data` is
retried for five sessions after the horizon; every other engine error is a terminal unscorable
row at once. The AI never scores itself; nothing it wrote is read at scoring time but the stored
claim.

**Journal.** `/diario` lists accepted analyses with their outlook and score. An analysis of a
signal, a contemplated operation or a held operation sits under the first decision on the same
subject recorded at or after it (the decision it informed); any other analysis is its own entry
in the timeline. The track record keeps decision scores and analysis scores apart: hit rate,
calibration and P&L stay decisions only, and the "AI calibration" panel shows the analyses'
hit rate, mean Brier and, per likelihood, its nominal probability next to the realized hit rate.

**Versions.** `analysis@1` stays frozen and readable: its accepted rows render without an outlook
and are never scored. New requests use `analysis@2`.

## Consequences

ADR-0005's "every AI analysis is scored" holds again for analyses requested with `analysis@2`
or later; ADR-0057's "only decisions are scored" paragraph is superseded. ADR-0057 otherwise
stands: subjects, facts, citation check, models, cap and storage are unchanged.

## Considered options

- Let the model write the level and the horizon date: two more figures for the citation check to
  police, and a date the model would have to compute from a session count.
- A numeric probability from the model: a number not in the inputs, against ADR-0009.
- Reuse the `analysis@1` confidence level as the claim's probability: it grades the evidence, not
  the outcome, and its `low` has no direction.
- Resolve the horizon at scoring time: every pending analysis would be re-read every night, and
  the journal could not show its date before it is scored.
