---
status: accepted
date: 2026-10-26
---

# "Obter sugestões" re-validates the radar's recent findings on demand (#356, amends 0066, 0067)

## Context

The radar reads each close once, at night (ADR-0066), and today's suggestions speak only for the
newest close and only until the radar reads a newer one (ADR-0073). On 2026-10-26 the owner asked
for a button, "Obter sugestões", that looks beyond that single night: walk what the radar found
over the last few sessions, check each finding again at the newest close and against the user's own
risk limits, and say what still holds, what no longer does and what was left out, and why. This is
part 1 of 3: the computation and the screen. Part 2 adds the AI "friend" with a closed verdict and
stores the research; part 3 widens the nightly sentiment universe to the radar's tickers.

## Decision

1. **On demand, per user, nothing stored.** The research is a Server Action of the signed-in user
   (`researchSuggestionsAction`, `modules/radar/research-actions.ts`), computed on each click like
   the asset reading (ADR-0059) and the risk check on a card (ADR-0067). It writes no table and
   needs no migration. The only per-user inputs are the risk profile and the open-operation count,
   read through `portfolio` (`getMyRiskContext`, user-scoped repositories, a `portfolio_read`
   access-log row); the findings, market data and recipes are shared reference data.
2. **Candidates.** The `radar_matches` of the last **5** read sessions (a session with at least one
   reading), newest first, deduplicated by `(underlying, recipe)` keeping the newest, which also
   carries the session it was found on and the stored suggestion id of that match, if any. A
   recipe no longer in the book is skipped, as the radar tab does. Five sessions is a trading
   week; it is this project's default (`RESEARCH_WINDOW_SESSIONS`).
3. **Re-validation at the newest close.** The newest close is the latest trading session on or
   before now for which the candidate underlyings have a candle (so a night the ingestion has not
   finished does not turn every finding into "no price"). Per distinct underlying one market view
   is built at that close (`buildRadarView`, ADR-0066 item 5), then for each candidate recipe the
   same two engine calls the nightly scan makes: `evaluateStrategy` (the rule holds when the
   outcome is one of the condition-held set, ADR-0066 item 3) and `priceOperation` for one standard
   lot (ADR-0067 item 1), now passing the user's risk profile and live open-operation count. The
   scan and the research share this code (`recipeEntryHeld` and `priceRecipeLot` in
   `read-underlying.ts`); the scan passes no profile. An underlying with no candle at the newest
   close, or that the engine cannot read, counts as `unpriced`.

   The entry check has three results, not two: held, conditions not met (the engine's
   `conditions_not_met`) and not evaluable (`insufficient_data`, e.g. the IV index has no point
   at the newest close yet, so `iv_rank` is unknown). Only the second raises
   `rule_no_longer_holds`; the third is dropped as `not_evaluable`, since the rule did not stop
   holding, it could not be checked. The scan treats both non-held results as no match, as before.

4. **Drops, counted by reason, never shown as cards.** `unpriced`: not every leg priced, max loss
   unbounded, no shared expiry (the conditions of a suggestion, ADR-0067 item 1) or no data at the
   newest close. `not_evaluable`: the rule could not be checked (item 3). `expires_too_soon`: fewer than **5** trading sessions between the newest close
   and the expiry (a lot that near expiry leaves no time to decide and order). `exceeds_capital`:
   the lot's max loss is greater than the whole declared capital (equal is kept). The reasons apply
   in that order, once per candidate. 5 is this project's default (`MIN_SESSIONS_TO_EXPIRY`).
   With today's book every recipe needs at least 20 business days to expiry, so at a 5-session
   window `expires_too_soon` and `near_expiry` cannot trigger yet; they guard against a recipe or
   window change.
5. **Alerts, a closed list computed on the card.** `rule_no_longer_holds` (with the session the
   finding was made on; the idea goes under "Deixaram de valer", the others under "Ainda valem
   hoje"), `limit_breach` (one per breached limit, straight from the engine's `limitBreaches`) and
   `near_expiry` (within **10** trading sessions of the newest close, two weeks, where time decay
   speeds up; `NEAR_EXPIRY_SESSIONS`, also this project's default). An idea whose rule stopped
   holding is still priced and shown with its alert, because the owner wants to see what changed.
6. **A default risk profile, said out loud.** A user with no declared profile gets the one the risk
   form already proposes: capital R$ 50.000,00, max loss 2%, max exposure 10%, 5 open operations,
   max premium bought 5%. It is one constant in `portfolio` (`DEFAULT_RISK_PROFILE`) that the form
   and the research both read, since the two must change together. The result carries
   `usingDefaultProfile` and the screen says so with a link to `/configuracoes/risco`. It is a
   working assumption for the research only; it is never saved as the user's profile.

   This does not reopen ADR-0066's rejected "reference risk profile": that option sized a
   proposal's quantity from invented capital. Here nothing is sized: the lot stays
   `SUGGESTION_LOT`, the capital only drops an idea whose max loss exceeds it and sets the limits
   the engine reports breaches against, the screen says the default is in use, and nothing is
   stored.

7. **Order and bound.** Within each group: option series traded at the newest close (descending),
   then ticker, then recipe id, the radar's rule, never a score (ADR-0066, ADR-0067 item 7). The
   Server Action is rate limited per account (`radar/research`, 6 per 60 s) and stops itself after
   about **45 s**, returning what it has with `timedOut`; the home page, which hosts the action,
   sets `maxDuration = 60` so the platform does not cut it first.
8. **Screen.** "Sugestões de hoje" on the home always renders, even when there are no suggestions
   today, so the button is always reachable. The button shows "Pesquisando…" while it
   runs. The answer is a one-line summary, the default-profile notice when it applies, and two
   groups of cards: "Ainda valem hoje" and "Deixaram de valer", each card with the re-priced lot,
   its alerts, a link to the original suggestion when one was stored and one to the asset. No
   decision bar and no builder link in this part: a research idea has no id until part 2 stores it.
9. **Result contract.** The action takes no input, and its result is an engine product built on
   the server from engine types (`AssetReading`, `OperationPricing`) that have no Zod schema, so
   it is typed but not schema-validated at the boundary. Part 2, which stores a research, will
   validate what it writes.
10. **Terms.** The research is a computation over the engine's own outputs like a suggestion; it
    adds no AI call, no recommendation language beyond ADR-0067's and no new personal data.

## Consequences

- ADR-0066 item 3 and ADR-0067 item 1 describe the same evaluation and pricing the research now
  repeats on demand, with the user's profile; the nightly scan is unchanged.
- A finding older than 5 sessions, or one whose underlying left the radar's universe since, is not
  re-checked.
- Each click re-reads one market view per distinct candidate underlying (a few seconds in all
  with the radar's usual tens of underlyings); the rate limit and the deadline bound the cost.
- The owner's list of "ideas" in the result is a research word, not a suggestion: an idea becomes
  a stored, decidable item only in part 2.

## Considered options

- Store each research and its ideas now: needed for decisions and the AI verdict, so it belongs to
  part 2, with its migration and isolation tests.
- Re-validate only the newest session's suggestions: that is what the panel already shows; the
  point of the button is the earlier findings.
- Hide the ideas whose rule stopped holding: the owner asked to see them, with an alert, to learn
  what changed.
- Require a declared risk profile: it would turn the button into a dead end for a new user, so the
  form's own defaults stand in, announced.

## Amendment (2026-10-27, ADR-0076)

Items 1, 7, 8, 9 and 10 change. When the AI answers, the research and its ideas are stored per
user (`suggestion_researches`, `research_ideas`, validated on read) and the screen shows the latest
one on load (1, 9). The home page's `maxDuration` is 180 s, not 60 (7). Stored ideas get the
decision bar and the builder link, and the pending copy changes (8). The click now makes an AI
call, with its own notice line when there is none (10). The engine part, its deadline and its
rules are unchanged; the ideas past the 20 sent to the AI stay engine-only and unstored. See
docs/adr/0076.
