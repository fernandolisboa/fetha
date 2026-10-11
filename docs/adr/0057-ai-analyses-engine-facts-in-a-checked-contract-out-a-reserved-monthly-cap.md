---
status: accepted
date: 2026-10-10
---

# AI analyses: engine facts in, a checked contract out, a reserved monthly cap (#28, sharpens 0009, amends 0005 and 0006)

## Context

ADR-0009 fixes the shape of an analysis: on demand, one object at a time, over engine artifacts
only, validated against a fixed output contract, with no figure the inputs do not hold, Opus for
thesis and strategy critique, Sonnet for routine reports, a monthly cap per user (default 50).
It leaves open how the inputs are assembled, how "no figure outside the inputs" is checked, where
prompts live, how the cap holds under concurrency and cost, and what leaves the system for the
model provider under the LGPD (ADR-0027). Production registration is `open` (ADR-0020), so every
call is paid by the owner's key for any account.

## Decision

**Subjects.** A user asks for an analysis of one of four objects they own: a signal, a
contemplated operation, an open (held) operation of the real portfolio, or a complete backtest
run (the strategy version with its backtest). Model per subject: `claude-opus-5-5` for both
operation kinds (thesis and counter-thesis on capital at stake) and for a backtest run (strategy
critique); `claude-sonnet-5-5` for a signal (the routine daily report). Both run with adaptive
thinking at effort `medium`, structured output (`output_config.format`) and the API's server-side
refusal fallback (`fallbacks: "default"`); the stored model is the one that answered
(`response.model`).

**Facts.** The `decisions` module assembles one `AnalysisInputs` per request: the subject kind,
the session it is read at, and a tree of named facts whose every leaf is a string formatted the
way the screen shows it (DESIGN.md formatting: `R$ 1.234,56`, `2,08%`, `17/10/2026`) or null.
The model cites figures by copying them; it never sees a raw centavo or fraction it would have to
convert. Per subject:

- signal: kind, ticker, session, indicator readings, the exit or adjustment rule, and for an
  entry or adjustment the proposal's engine pricing (below), as stored on the signal;
- contemplated operation: structure, underlying, legs, and the engine's pricing re-run at request
  time (`portfolio`'s pricing path, the builder's own);
- held operation: underlying, opening date, expiry, legs with their average entry price, and the
  engine's pricing of those legs re-run at request time;
- backtest run: period, universe, initial capital, cost model, the strategy definition without
  its name, the engine's metrics, walk-forward windows, and counts of operations, missed entries
  and limit breaches.

Pricing is spot, risk-free rate, dividend yield, each leg's premium, fair value, implied
volatility and greeks, the net premium, aggregate greeks, break-evens, max loss and max gain, at
most 21 payoff points evenly sampled, the codes of breached limits and of engine notes.

**What is never sent.** No identifier of the user (id, name, email), no text the user wrote
(strategy name, decision rationale or thesis), no declared capital, no risk-profile limit values
(only which limit an operation breaches), no fill ids or record ids, no timestamps finer than the
session. The only free text in the payload is closed vocabulary (tickers, codes, enum values), so
user text cannot carry an injection. The payload is serialized as JSON inside one delimited block
with `<`, `>` and `&` escaped, and the system prompt tells the model to treat it as data. The
privacy policy names Anthropic as a fourth supplier receiving this payload (new terms version).

**Output contract** (`packages/contracts`, `analysisOutputSchema`): thesis, counter-thesis, one to
six key risks, an assessment of max loss, an assessment of break-evens, one to five invalidation
conditions, confidence as a closed level (`low`, `medium`, `high`, never a number the model makes
up) with its justification, and `inputsCited`, the fact paths the reasoning used.

**Citation check** (`packages/contracts`, `checkAnalysisCitations`). A reply is accepted only if
it parses against the schema, every cited path names a fact that exists, and every figure in the
output text equals, by absolute value, a figure in the facts. A figure is a run of digits not
glued to a letter (so `PETR4` and `B3` are names, not figures), read in pt-BR notation; a date is
compared as a date. Anything else is rejected with the offending figures or paths recorded; the
rejected text is never shown or stored.

**Prompts.** `prompts/` is a workspace package (`@fetha/prompts`). Each prompt has an id and a
version (`analysis@1`); a change to its text is a new version, and the version is stored with
every request. Fixture tests hold recorded inputs and golden outputs that must pass the schema
and the citation check, plus adversarial fixtures (an injection inside a fact, replies that cite
figures or paths outside the inputs) that must be neutralized or rejected. This amends ADR-0006's
"prompts live in `apps/web`": a prompt is pure text and fixtures over a frozen version, the same
kind of seam `packages/engine` and `packages/contracts` already carve out, so it lives in its own
package instead.

**Outcome and the time budget.** `failed` means no reply ever came back: any `Anthropic.APIError`
(including a connection or timeout error). `rejected` means some reply came back but was unusable:
a refusal, a schema failure, a citation failure, or any `stop_reason` other than `end_turn` or
`stop_sequence` (`max_tokens`, `model_context_window_exceeded`, `pause_turn`...) — the call was
paid, so it counts toward the cap; a `failed` one does not. The SDK call itself runs with
`timeout: 100_000` and `maxRetries: 0`: the route handlers' own `maxDuration` is 120s, so the model
call leaves headroom to classify the reply and write the result row within that budget, and a
retried call that still failed would leave none. A request with no result row yet (the model call
is still in flight, or the handler was killed by the platform before it could write one) counts
toward the cap only for its first 5 minutes; past that it ages out, so an orphaned reservation
never holds a slot forever. A request with a stored result counts exactly when that result is not
`failed`.

**Walk-forward windows.** A backtest run's facts keep at most the 12 most recent walk-forward
windows (the ones closest to the current regime), not the oldest 12, plus a fact stating how many
were left out.

**Fact depth.** `analysisFactsSchema` caps nesting at `MAX_FACT_DEPTH` (20 in `packages/contracts`):
deep enough for the deepest tree assembly can produce for a legal strategy (a condition at
`MAX_CONDITION_DEPTH`, inside an exit rule, inside a `roll` adjustment's `when`, measuring 18 by
this module's own depth count), kept with margin above that.

**Storage and cap.** `analysis_requests` (the inputs, subject, prompt version, requested model,
time) and `analysis_results` (outcome `accepted`, `rejected` or `failed`, the output when
accepted, the reason otherwise, the answering model and token usage), both user-scoped,
append-only and in the account export. A request row is inserted before the model is called,
inside a transaction under the per-user advisory lock of ADR-0032 (`analysis_requests` scope),
after counting this calendar month's (America/Sao_Paulo) requests under the rule above. At 50 the
action answers `cap_reached`. Requests are also limited to 3 a minute per account. Without
`ANTHROPIC_API_KEY` the action answers `unavailable` before reserving anything, and the screen
says the analysis is unavailable.

**Scoring** of analyses and their place in the journal are not part of this decision; they need
a horizon and a claim the contract does not carry yet (follow-up issue). This amends ADR-0005's
"every AI analysis is scored" and ADR-0009's "scored like decisions": until that follow-up
lands, only decisions are scored.

## Considered options

- Hold the advisory lock across the model call: one row, no reservation, but a transaction open
  for up to a minute per request.
- Count only stored results at insert time: concurrent requests at 49 all pass and overspend.
- Send raw engine values (centavos, fractions) and let the model format them: every percentage
  or amount it writes becomes a conversion the check cannot tell from an invented number.
- Send the strategy name for readability: user text reaches the model, the opposite of
  minimization, for no analytic gain.
- A numeric confidence from the model: a number not in the inputs, against ADR-0009's own rule.
