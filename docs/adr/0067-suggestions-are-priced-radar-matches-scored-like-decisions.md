---
status: accepted
date: 2026-10-13
---

# Suggestions are priced radar matches, spoken in direct voice and scored like decisions (#311, amends 0014, 0057, 0058, 0066)

## Context

The radar (ADR-0066) says, in a recipe's voice, "a receita X encontrou entrada em PETR4" and prices
one unit of the structure. The owner, the app's only user, asked on 2026-10-13 for the app to speak
in its own voice instead — "Sugestão de hoje: uma trava de alta com calls em PETR4 cabe agora" —
with the numbers of something one could actually trade, a way to act on it (decide, analyse, test
the recipe, open the builder) and a record of how the app's own suggestions age, next to the
user's own track record (#311, epic #303). On the same day the owner lifted the earlier stance
that Fetha "is not a recommendation": Fetha suggests; it still never sends or automates an order
(ADR-0003 stands) and nothing about it is paid.

That stance was never an ADR of its own. It lived in the terms of use (versions `2026-09-27.3` and
`2026-10-10.1`: "não é consultoria, recomendação de investimento ou análise de valores
mobiliários nos termos das normas da CVM" and "uma análise por IA ... não é recomendação"), in the
`2026-10-10.1` terms change summary, in the glossary's _avoid_ lists for Radar, Signal and
Analysis, in the system text of the frozen prompts `analysis@1` and `analysis@2` ("is not
investment advice") and in ADR-0066 item 7, which deferred the direct voice to this issue.
`docs/adr` holds no ADR that forbade recommendations in those words; ADR-0003's "decision support
only" is about execution, not about voice, and is unchanged.

## Decision

1. **A suggestion is a radar match priced for one standard lot.** The nightly scan prices each
   match with `priceOperation` for one B3 standard lot, 100 units per ratio unit of the structure
   (`SUGGESTION_LOT` in `modules/radar/suggestion.ts`), so the premium, max loss and max gain read
   as the amounts of a real order. This amends ADR-0066 item 3, which priced one unit; the match's
   own `legs` still record the series the structure resolved to. A match becomes a suggestion only
   when the engine priced every leg (each price is the entry the suggestion is later scored
   from), its max loss is bounded and every option leg shares one expiry (ADR-0014 Q43). A match
   that fails any of these stays a radar row and nothing more.
2. **Shared reference data.** New table `suggestions` in the `radar` module (`id`, `underlying`,
   `session`, `recipe_id`, `as_of`, `legs`, `pricing`, `claim`, `horizon`): no `user_id`, written
   only by the nightly scan, read by every user, the radar's own class. Unique on
   `(underlying, session, recipe_id)`, foreign key to `radar_matches` deleted with its match
   (cascade), and `horizon > session` checked. Sizing to a user's capital is never stored: when a
   card or the suggestion page is shown, the lot is re-priced at the suggestion's close with the
   signed-in user's risk profile (`priceOperation`) and any limit breach is shown for that user
   only, computed on each request like the asset reading (ADR-0059).
3. **Claim and horizon.** The suggestion's thesis claim comes from the ADR-0014 vocabulary: with
   exactly one break-even, `close_above` or `close_below` that break-even, the side read from the
   engine's own payoff at its highest sampled underlying (positive there means the structure gains
   above); with none or several break-evens (a butterfly, a straddle, a strangle), the claim is
   `operation_pnl_positive`. The horizon is the options' shared expiry.
4. **Scored like a decision, as the lot entered at the close.** A new nightly step right after
   decisions and analyses, on the same as-of session and the same deadline, scores every suggestion
   whose horizon has arrived with the engine's `score`: subject `enter`, the operation is the
   priced lot entered at the engine's own leg prices at the scanned close, `openedAt` the scanned
   session, no fills, origin `manual` (no strategy version stands behind it), the B3 default cost
   model, and confidence asserted as `1`. A suggestion states its claim without a likelihood, so
   its Brier is 0 when the claim held and 1 when it did not — the miss rate; the journal never
   shows this Brier, only the hit rate and the P&L. One append-only row per suggestion in
   `suggestion_scores` (the `Score` or a terminal `unscorable_reason`, exclusive; plus
   `claim_held`, `pnl_centavos`, `max_loss_centavos`, `normalized_pnl` and the engine version); a
   trigger blocks `UPDATE`, `DELETE` stays allowed so a suggestion removed with its match takes its
   score along. `insufficient_data` is retried for five sessions after the horizon (ADR-0014 Q54's
   window) and then recorded `unscorable`; every other engine error is terminal at once. The
   nightly report (ADR-0045) gains an optional `suggestionScoring { scored, skipped, errorCount }`.
5. **A decision on a suggestion.** `decisions` gains origin kind `suggestion` and a nullable
   `suggestion_id` (foreign key to `suggestions`, no action on delete, like `signal_id`), one
   decision per user per suggestion (unique partial index on `(user_id, suggestion_id)`), kinds
   `enter` and `do_not_enter`. Its inputs snapshot the suggestion as the user saw it: underlying,
   recipe, structure, session, expiry, legs with their entry prices, net premium, max loss and max
   gain. It is scored like any decision: the lot rebuilt from its snapshot at its snapshotted
   prices, origin `manual`, the convention a signal's proposal already follows (not re-priced at
   the decision instant, as a contemplated operation is), so the user's answer and Fetha's own
   score judge the same lot. Both therefore enter at the scanned close, a fill nobody could get
   after the suggestion existed; a next-session fill is a known refinement, not taken here.
   Decisions stay user-scoped; the suggestion they point to is shared.
6. **One analysis of one suggestion, on request, with a verdict.** `suggestion` is a fifth analysis
   subject (ADR-0057's cap, rate limits and storage unchanged; model Opus, as for an operation).
   The facts sent are the suggestion as the cards show it, the recipe's entry rule, the asset
   reading's labels, the entry close and the indicators that fired, and the engine pricing of the
   lot. Prompt `analysis@3` adds one required field to the output contract
   (`analysisOutputV3Schema`): `verdict`, `{ decision: enter | wait | do_not_enter, justification }`
   for a suggestion and `null` for every other subject. A verdict missing on a suggestion, or
   present on another subject, is `rejected` (counted toward the cap) with reason kind `verdict`
   (`missing` | `unexpected`). The decision is a word from a closed list, never a number, and the
   justification goes through the same citation check as the rest of the reply. The AI never
   picks or ranks suggestions; it analyses the one the user asked about. `analysis@1` and
   `analysis@2` stay frozen and readable (`storedAnalysisOutputSchema` reads a row with whatever
   fields its version carried).
7. **Direct voice, no ranking.** The cards say "Uma trava de alta com calls em PETR4 cabe agora."
   and state, once per screen, that Fetha suggests from its recipes' rules, its models and past
   data, that a suggestion can be wrong, and that the decision — and any order at the broker — is
   the user's. Cards are ordered by how many option series traded at the close, like the radar's
   rows, never by a score (ADR-0066's "no attractiveness score" holds).
8. **Acting on a suggestion.** "Ver receita" opens `/sugestoes/[id]`: the rule, the numbers, the
   reading, the decision bar and "Testar esta receita", which reuses the recipe start flow
   (ADR-0064 item 5: copy the recipe as the user's strategy, add the ticker to the watchlist,
   run a two-year backtest). "Cached" there means the user's own stored run: the page looks up the
   user's existing recipe strategy for that ticker by the name the start flow gives it
   ("<structure> em <ticker>") and links to its run instead of starting another. This is a
   deliberate simplification over recording recipe provenance on copied strategies (ADR-0064's
   "add provenance only when a feature needs it"): a strategy the user created by hand under the
   same name is matched too, which is acceptable for a name the flow itself coins. "Montar no
   simulador" opens the builder prefilled with the suggestion's structure, underlying and legs at
   quantity 100.
9. **The journal shows how Fetha's suggestions age.** `/diario` gains a "Sugestões do Fetha"
   calibration panel, per recipe and overall: how many scored suggestions, the share whose claim
   held and the summed P&L per lot in the engine's centavos, read from `suggestion_scores`. Shared
   reference data, the same for every user, kept apart from the user's own track record and from
   the AI calibration panel (ADR-0058).
10. **Terms.** The "Toda decisão é sua" section of the terms now says that Fetha suggests
    operations from its own rules, models and past data, that suggestions and analyses can be
    wrong, that Fetha is still not a broker and places, automates or connects to no order or
    broker, and that every decision — and every order placed at the broker — is the user's alone,
    with its results. The CVM sentence is gone. `CURRENT_TERMS_VERSION` moves to `2026-10-13.1`
    with a change summary; the ADR-0036 gate asks every existing user to re-accept on their next
    document load.

## Consequences

- ADR-0066 item 3 is amended (one lot, not one unit) and its item 7 is fulfilled; items 1, 2,
  4–6 and 8 stand. ADR-0057 and ADR-0058 gain a subject and a prompt version; cap, facts
  discipline, citation check, outlook and scoring are unchanged. ADR-0014's thesis-claim vocabulary
  is reused unchanged; the asserted confidence of `1` is new and local to suggestions.
- A suggestion's score measures the suggestion, not the user: it assumes the lot was entered at
  the engine's leg prices at the scanned close and held to expiry with no exit rule, so it is a
  "cabe agora" check, not a backtest of the recipe (whose exits the start flow tests). A user who
  entered sees two scores, their decision's and the suggestion's, in two panels.
- Hit rate, not calibration: with every confidence at `1`, Brier equals the miss rate and carries
  no information the hit rate does not, so it is stored in the `Score` but never shown.
- No retention yet, like the radar: one row per match per session plus one score each. A recipe
  removed from the book drops its suggestions from every screen (the view resolves against the
  book), while the rows, their scores and the decisions pointing at them stay.
- The nightly job has one more step under the same deadline; a run that ends before it leaves
  suggestions due for the next run, like decisions and analyses.
- `radar` now depends on `backtests` (the default cost model) and reads the engine's `score`;
  `decisions` depends on `radar` for the suggestion a decision answers.
- Every user re-accepts the terms once. The frozen `analysis@1`/`analysis@2` system texts keep
  "is not investment advice" because a prompt version is immutable (ADR-0057); new requests use
  `analysis@3`, which says Fetha suggests.

## Considered options

- Price one unit and multiply on screen: the engine's costs and limit checks would not be the
  lot's own, and the stored pricing would not be what the user read.
- Per-user suggestions sized by each risk profile, stored: multiplies rows per user and turns
  user-derived figures into reference data; re-pricing on display gives the same breach for free.
- A likelihood for each suggestion (from the recipe's backtest hit rate, say): a number no engine
  fact supports for this one match; the owner asked for a claim, and the hit rate the journal
  shows is the honest version of it.
- Let the AI pick or rank today's suggestions: the AI never produces numbers and the ordering must
  come from a fact (ADR-0066); it analyses one suggestion on request instead.
- A verdict only in the suggestion subject's own output schema: one nullable field with a
  subject check keeps one stored shape per version and one citation check over all its prose.
- Recipe provenance on copied strategies for the "cached" run: a migration and a new column for a
  lookup the strategy name already answers for the only user; revisit if the name rule changes.

## Amendment (2026-10-26, ADR-0072)

"Sugestões de hoje" no longer shows the newest read session's suggestions indefinitely: a
suggestion is open through the São Paulo day of the trading session after its close, then
archived. An archived suggestion leaves the panel, keeps its page and its score, and takes no new
decision (item 5); its page shows no decision bar (item 8).

## Amendment (2026-10-26, ADR-0073)

ADR-0073 replaces ADR-0072's window: a suggestion is archived once the radar reads a newer close,
never by the date; while ingestion lags, the panel keeps the newest read session's suggestions
with a warning of how many closes are overdue.

## Amendment (2026-10-26, ADR-0074)

Each user may have "Sugestões de hoje" drop the suggestions they have already seen, a delay they
choose after the first sighting (off by default). The sightings are user data in
`suggestion_sightings`, so `radar` now owns one user-scoped table. This does not change the
archiving above: a suggestion taken off one user's panel still takes decisions while open and is
scored for everyone.

## Amendment (2026-10-26, ADR-0075)

Item 1's one-lot pricing also runs on demand for the signed-in user, with their risk profile (or
the risk form's defaults when none is declared) and their open-operation count passed to the
engine. Nothing is stored, and the declared capital only drops an idea whose max loss exceeds it:
it never sizes the lot, which stays `SUGGESTION_LOT`. See docs/adr/0075.
