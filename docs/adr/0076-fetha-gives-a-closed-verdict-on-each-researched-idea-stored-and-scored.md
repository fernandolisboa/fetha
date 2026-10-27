---
status: accepted
date: 2026-10-27
---

# Fetha gives a closed verdict on each researched idea; the research is stored and each idea scored (#358, amends 0009, 0057, 0058, 0065, 0067, 0075)

## Context

Part 1 of "Obter sugestões" (ADR-0075) re-checks the radar's recent findings with the engine only
and stores nothing. On 2026-10-26 the owner approved part 2: one AI call over those ideas that
gives each a closed verdict, a stored research, and a score for every idea at its expiry so the
journal can say whether the verdicts age well. This ADR amends six decisions:

- ADR-0067 item 6 said the AI never picks or ranks suggestions. It now **picks by a closed-list
  verdict** (`enter` | `wait` | `do_not_enter`) on ideas the engine already priced. It still never
  ranks, orders or scores numerically, and it still writes no number.
- ADR-0009 said an analysis is for one object and never runs in batch. A research is one analysis
  of a set: the ideas the engine found together, whose verdicts only make sense next to each other
  (an overview, and "none is worth it today"). It is still on demand, over engine artifacts only,
  one call at the user's click, never automatic.
- ADR-0065 left whether filing labels and news tone enter the facts of an AI analysis to a later
  ADR. This is that ADR: they do, for a research only and cut at the newest close (item 2).
- ADR-0057: a sixth analysis subject, `research`, its facts and its rejection reasons.
- ADR-0058: `research@1` has no outlook and no likelihood; an idea's score comes from the engine's
  lot.
- ADR-0075 items 1, 7, 8, 9 and 10: the research is stored when the AI answers (1) and what is
  stored is validated (9); the home page's `maxDuration` goes from 60 to 180 s (7); stored ideas
  get the decision bar, the builder link and the pending copy (8); and the click now makes an AI
  call (10).

## Decision

1. **A sixth subject, `research`, through the whole ADR-0057 pipeline.** One research is one
   analysis: it is reserved under the per-user advisory lock, counts one against the 50 a month
   (`MONTHLY_ANALYSIS_CAP`), is limited by `analyses/request` (3 per 60 s) on top of part 1's
   `radar/research` (6 per 60 s), runs with the SDK's 100 s timeout and ends `accepted`, `rejected`
   or `failed` in `analysis_requests`/`analysis_results`. The pipeline is not copied: the
   reserve/call/classify/citation core of `requestAnalysis` is extracted as `askUnderCap`
   (`analysis-service.ts`) and both subjects call it, each with its own output schema and its own
   post-parse checks. The default family is Opus (`defaultAnalysisFamilies.research`), overridable
   in the AI settings panel, whose label is "Pesquisa de sugestões". The subject has no subject
   id of its own: the request's `subject_id` is the id the research will have, generated before
   the call. Researches are kept out of the analyses journal (`listAcceptedForJournal` skips the
   subject): the user sees them in "Sugestões de hoje" and in "Pesquisas do Fetha", not as one
   analysis among their operations. `research` is a subject kind but not an object kind
   (`analysisObjectKinds`, the kinds `requestAnalysisAction` accepts): a research is asked only
   through `obtainSuggestionsAction`, and the single-object action refuses it.
2. **What is sent.** `AnalysisInputs` with `subject: "research"` and `facts` made only of display
   strings, null and arrays of them (ADR-0057): `newestClose` and `ideas.<n>`, in the order the
   engine gave them. An idea carries `underlying`, `structure`, `foundOn`, `ruleHolds`, `expiry`,
   `sessionsToExpiry`, the recipe's `expectedMove`, `ivRegime`, `entry` and `exit`, the asset
   `reading` labels (with the number of option series traded at the close), `engineAlerts` as codes
   only, `pricing` (the lot at the newest close, payoff sampled to at most **9** points per idea
   by the same `pricingFacts` the suggestion subject uses), `recipeTrackRecord` (the shared
   suggestion calibration for that recipe: the scored count, the share whose claim held and the
   **average** result of one lot, which does not grow with the count; null when none was scored),
   `filings` (at most 5, newest first, from the sentiment module's existing view), `newsTone` and
   `providerNews` (null or empty when the sentiment tables hold none; nothing is fetched; the
   provider's articles are kept for a ticker with no mapped company, dated by their São Paulo
   day). **Every context fact is cut at the newest close**, not at the time of the click: the lot
   is entered and scored at that close, so nothing delivered after it may inform the verdict. The
   windows end at the close's instant; articles published up to it count; filings and tone points,
   which are dated by day, count only for earlier days (a day's filing cannot be placed against
   the close), and a later version of a filing does not hide the version known then. Never sent: the declared capital, any
   limit value (an idea that breaches a limit sends the code `limit_breach:<limit>` and nothing
   else, since the value derives from the capital), a user id, a strategy name or any text the
   user wrote. A test asserts the absence. The privacy text names these limit names (item 11).
3. **At most 20 ideas are sent**, holding first, then no longer holding, each in part 1's order
   (`MAX_RESEARCH_IDEAS_SENT`). The model never orders ideas. Ideas beyond the 20 are shown with the
   engine's numbers only and a line "N ideias não foram enviadas ao Fetha". They are not stored,
   so a reload shows only the 20 that were sent, with that count not repeated; this keeps one
   row per idea that has a verdict, a claim and a score.
4. **Output `research@1`** (`researchOutputSchema`, `@fetha/contracts`; prompt `research@1` in
   `@fetha/prompts`, frozen by digest). `overview`, and one entry per sent idea: its fact path
   (`ideas.<n>`), `verdict`, `justification`, `alerts` (closed list of 9, 0..5, no duplicates) and
   `inputsCited` (existing fact paths, at least one: an opinion that cites nothing is not
   checkable). Rejected, counted toward the cap and never shown: a schema
   failure; ideas that do not cover every sent idea exactly once (reason kind `research_ideas`,
   with the problem: `missing`, `duplicate` or `unknown`); any citation failure over `overview`
   and every `justification` against all the facts (`checkAnalysisCitations` is not weakened; the
   prose check is shared with it, `checkProseCitations`); a storage failure (item 5). The prompt
   speaks as Fetha, in Portuguese, may say "nenhuma vale a pena" and is told it may answer
   `do_not_enter` for every idea. The contract carries its own token budget,
   `RESEARCH_MAX_OUTPUT_TOKENS = 20 000` (thinking included): the bounds (overview 800 characters,
   a justification 600, at most 8 cited paths of at most 80) put twenty ideas at about 10 000
   tokens at the very most, a test holds that to half the budget, and the single-object default of
   8 000 would cut a full research off. 20 000 stays under the SDK's limit for a request that is
   not streamed.
5. **Storage, one transaction.** Migration 0048 adds three tables owned by `decisions`, all
   user-scoped (`user_id` on every row, composite foreign keys `(x_id, user_id)`) and append-only
   (a trigger raises on UPDATE; rows go with the account):
   - `suggestion_researches`: the request, the newest close, how many sessions were looked at, the
     candidates, the drops by reason, whether the default profile was used;
   - `research_ideas`: the lot (`legs` by the radar's schemas; of `pricing` and `reading`, the
     fields the card, the decision and the facts read: the premium, loss, gain and break-evens,
     and the asset reading's labels and figures, the rest kept as the engine wrote it), all
     validated before writing and again on read, so a row that no longer fits is dropped rather
     than drawn wrong; the engine alerts, the verdict, justification, AI alerts, cited paths, the **claim**
     (`suggestionClaim(pricing)`, ADR-0067 item 3) and the **horizon** (the shared expiry, checked
     `> newest_close`). `reading`, `sessions_to_expiry` and `newest_close` are stored too, so the
     card draws exactly as shown and a decision snapshots it; `suggestion_id` points at the radar
     suggestion when the finding had one, with no action on delete like `decisions.suggestion_id`;
   - `research_idea_scores`: one row per idea, `Score` fields or a terminal `unscorable_reason`.

   The result row, the research and its ideas are written in a single database transaction
   (`ResearchRepository.storeAccepted`, which calls `AnalysesRepository.complete` with the
   transaction). If it fails, none is left and the request is settled as `rejected` with kind
   `storage`, counted toward the cap, since the model was billed. `decisions` gets
   `research_idea_id` (composite FK, unique partial index: one decision per user per idea) and its
   origin check admits `research_idea`; `analysis_requests_subject_kind_check` admits `research`.

6. **Scoring.** The nightly job gains `researchScoring` right after suggestion scoring (same as-of
   session, deadline and report shape: optional `researchScoring { scored, skipped, errorCount }`,
   ADR-0045). Each idea is scored exactly as a suggestion (ADR-0067 item 4): subject `enter`, the
   lot entered at its stored leg prices at `newest_close` (the close instant of that session), the
   default B3 cost model, confidence 1, the stored claim, no fills. `insufficient_data` is retried
   until 5 sessions after the horizon, then recorded as unscorable. The scoring itself is the
   helper radar shares with suggestions (`scoreAssertedLot`), so the two cannot drift. An idea
   whose stored lot no longer parses is settled as `invalid_stored_idea` instead of staying due
   every night. Every verdict is scored,
   `do_not_enter` included, so "Pesquisas do Fetha" can say what the discarded ideas would have
   made. A research idea that is also a suggestion is scored twice, once per table, by design: they
   are different questions (the radar's rule versus Fetha's verdict).
7. **Decisions and builder.** `decisions` has origin `research_idea` with the ADR-0067 item 5
   conventions: kinds `enter` and `do_not_enter`, inputs that snapshot the idea as shown, scored
   like a suggestion's decision. Because the idea was priced at the research's newest close, a
   decision is refused (`archived`) once the radar has read a newer close, as ADR-0073 does for a
   suggestion: answering later is answering with hindsight. Each stored idea card has the decision
   bar and "Montar no simulador" (`/carteira/nova-operacao?pesquisa=<id>`, the legs at quantity
   100, the suggestion's builder helper). Engine-only cards keep part 1's links.
8. **Screen.** The result replaces part 1's two groups when the AI answered: Fetha's overview, then
   "Vale a pena" (`enter`), "Com ressalva" (`wait`) and "Descartadas" (`do_not_enter`, collapsed,
   "N ideias descartadas, ver por quê"). A card shows the engine's numbers, the justification, the
   AI's alerts as chips (visually apart from the engine's) and, in a disclosure, the facts cited
   with readable labels. With no `enter`: "Olhei N ideias de M pregões e nenhuma vale a pena hoje."
   On load, the panel shows the user's latest stored research when its `newest_close` is the
   radar's newest read close, with "Pesquisa de dd/mm/aaaa às hh:mm · modelo" and the button
   "Pesquisar de novo"; an older one is not shown. A single Server Action,
   `obtainSuggestionsAction`, runs part 1's `researchSuggestionsAction` and then the model call; it
   answers with the engine result and either the stored research or one notice line (no key, key
   unreadable, cap, rate limit, failed). Zero ideas, no readable key or a reached cap reserve
   nothing and charge nothing. The key is checked before the per-minute token is spent. Once the
   engine's research exists, nothing in the AI step may take it away: any error there is logged
   (`safeDbErrorMessage`) and answered as the `failed` notice with the engine's cards, and if the
   research was stored and only the re-read failed, it is on the next page load.
9. **Timing.** The engine part keeps its 45 s deadline and the model call its 100 s timeout, so
   the home page's `maxDuration` is **180 s** (Vercel Pro allows 300). The model call may start
   at the latest 180 − 100 − 15 = **65 s** after the action began: the 15 s of headroom pays only
   for what follows the call (settling the reservation, the storage transaction, re-reading the
   stored research, revalidation). Everything before the call fits between the engine's 45 s and
   that 65 s, which leaves 20 s for the key lookup, the per-minute token, the sentiment reads, the
   facts, the advisory-lock wait, the reservation and a cold start; a test asserts both sums. The
   limit is enforced, not hoped for: the action notes when it started, and the model call is
   skipped, with the `failed` notice and nothing reserved, if more than 65 s have gone by when
   the key is known (before the per-minute token is spent), and checked again after the facts are
   assembled, right before the call, which is the authoritative check. So the platform never
   kills a call that is already paid for.
10. **"Pesquisas do Fetha" in `/diario`.** From the user's own `research_idea_scores`, for each
    verdict: how many were scored, how many ideas had no data to be scored ("N sem dados", kept
    out of every figure), in how many of those the entry would have worked (the idea's claim
    held for the lot as if entered at the close of the research, so for "Descartadas" a high
    number means the discard was wrong) and the **average** result of one lot, B3 costs included,
    in the column "Resultado médio por lote". One sentence says what the discarded ideas would
    have made per lot, and it is the same figure as that verdict's row. Judgment call: the ticket
    quotes "teriam rendido R$ X por lote" and asks a summed P&L per lot; both are shown as the
    average per lot over the scored ideas, with their count, because a sum would grow with how
    often the user asks and mean nothing per lot. Asking again at the same close stores and scores
    the same lots again, so the panel counts only the latest research of each close
    (pseudo-replication otherwise). The panel is separate from the user's own track record, the AI
    calibration panel and the shared "Sugestões do Fetha" panel.
11. **Terms.** The privacy text said an analysis receives "the figures ... for that one object" and
    its lists of what is collected did not mention a saved research or scores. A research sends
    several ideas' figures plus public context for the same assets, the names (never the values) of
    the breached limits, and stores the result, so the text did not cover this payload. The terms version moves to `2026-10-27.1`: the processors and
    storage paragraphs name the research, the change summary on the re-acceptance gate says what
    changed. What is sent is still engine output and public data: no name, email, declared capital
    or user text.

## Consequences

- The ADR-0057 pipeline has one more subject; the analysis journal is unchanged (researches are
  not in it), and the 50/month cap is shared by all subjects.
- A verdict is a model's reading of engine figures, not a recommendation, and the calibration panel
  is where the user sees whether it ages well.
- Account export and deletion include the three new tables; each has an isolation test.
- A research stored for a close the radar has since passed stays in the database and in the
  calibration, but is not shown on the home page and takes no new decision.
- Part 3 (sentiment for the radar's tickers) needs no change here: whatever the sentiment tables
  hold is sent, and an underlying with none sends nothing.

## Considered options

- Write the research after the result row, in a second transaction: a failure between them would
  leave a billed, accepted answer with nothing to show, and a retry would pay again. One
  transaction makes the pair atomic.
- Store the ideas beyond the 20 sent: they have no verdict, so their score would measure the
  engine, not Fetha, and muddy the panel.
- Add `research` to the analyses journal: one research is many ideas, not one object, and its
  ideas already have their own decision origin and scores.
- Give the model an outlook and likelihood per idea (ADR-0058): a number the AI would own, against
  ADR-0009; the engine's own lot already yields the claim to score.
- A second call per idea: 20 times the cost and the cap, and no cross-idea overview.
