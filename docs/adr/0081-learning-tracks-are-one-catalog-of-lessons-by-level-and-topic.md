---
status: accepted
date: 2026-11-21
---

# Learning tracks are one catalog of lessons, grouped by level and topic (amends ADR-0059)

## Context

The owner is a beginner in options and barely remembers the basics; before risking money again
they want short, structured lessons rather than a wall of documentation. Taful (the owner's other
app) already answered this shape of question: `content/catalog.toml` and `docs/decisions.md` D23
settled on one catalog of lessons, each carrying a level and a topic, with a "Ver por" switch that
regroups the same lessons by either axis. This ADR adopts that model for Fetha's lessons, with the
engine and tenancy constraints Fetha itself adds.

A later ticket (PR 2) adds a third view, "Estruturas" (one lesson per option structure), a
first-run level question (Taful D25) and contextual links from elsewhere in the app into a
lesson. Taful's unlock modes (D24) are out of scope entirely: v1 ships with every lesson open.

## Decision

1. **One catalog, two views of the same lessons.** `apps/web/src/modules/learning/content/
catalog.json` lists every level, every topic and every lesson's id with its level and topic,
   in Jornada (by-level) display order; each lesson's own content lives in
   `content/<lesson-id>.json`. "Jornada" groups by level (display order: `first-steps`,
   `fundamentals`, `beginner`, `intermediate`, `advanced`); "Temas" groups the same lessons by
   topic (`options-basics`, `pricing`, `structures`, `risk`, `b3-rules`, `using-fetha`). Code
   always says `topic`, never `theme` — `theme` already names the per-user visual theme
   (ADR-0015, ADR-0069). Level and topic live only in `catalog.json`'s `lessons` entry, never
   duplicated on the lesson file itself; a lesson carries no `structures` field in v1 — PR 2's
   Estruturas view, when it arrives, extends the schema then, rather than reserving an unused
   field now.
2. **Zod at the edge, data not code.** `packages/contracts`' `lesson-catalog.ts` is the schema
   (CLAUDE.md principle 2: strategies, and now lessons, are data). Each lesson's text carries both
   locales (`{ en, pt }`, the i18n rule); blocks are a closed union (`paragraph`, `list`,
   `callout`, `payoff-example`); a quiz has 4 to 5 questions, each with exactly one correct option
   and an explanation shown after answering — 4 is the floor because a 3-question quiz needs a
   perfect run to clear the 75% passing bar, which defeats having a bar at all. A lesson has a
   `version`, bumped when its quiz changes, so a stored best score can tell a current attempt from
   a stale one.
3. **No hand-written numbers.** Any price, break-even or max gain/loss in a lesson is a
   `{{placeholder}}` resolved from the engine's own `priceOperation`, run over one fixed,
   fictitious market (`learning/illustrative-market.ts`, generalized from `help/options-101.ts`,
   which this ADR retires — its content becomes first-steps lessons, and `/como-usar` keeps only a
   pointer card to `/aprender`). `learning/placeholders.ts` resolves a closed, versioned set of
   tokens (`spot`, `lowerStrike`, `higherStrike`, `<exampleId>.premiumAbs`, `.maxLossAbs`,
   `.maxGainAbs`, `.breakEven0`) and throws on an unknown token or one that resolves to
   "unbounded" where a lesson expects a number, so a typo or a badly chosen example fails a
   content-check test instead of shipping a wrong number. A content-check test pins every
   lesson's resolved pt-BR text and quiz in a snapshot, so drift in wording or in engine output
   both fail loudly.
4. **Grading is server-side, always.** `grading.ts`'s `gradeQuiz` is the only code that ever
   compares a submitted answer against a question's `correctOptionId`, and `submitLessonQuizAction`
   is the only place that result (and the resolved `explanation`) ever reaches the client, after
   it has submitted its own answers. Before that, the client only ever sees `publicQuiz()`'s shape
   (question and option text, every `{{placeholder}}` already resolved server-side) and posts
   back `{ questionId, optionId }` pairs, checked against the lesson's own question ids
   (`answersMatchLessonQuestions`) before grading. Passing is ≥ 75% correct
   (`PASSING_SCORE_RATIO`); retry is always allowed and the stored row keeps the best score
   reached on the lesson's current version, plus the timestamp of the first pass, which a retry
   can never move — computed atomically in the upsert's own SQL, not read-then-written, so two
   concurrent attempts can never clobber each other. The action is rate-limited like other user
   actions (`enforceAccountRateLimit`). The one exception to "the client never sees the answer key
   before submitting" is `/api/e2e/lesson-quiz-answers`, an E2E-only route guarded the same way as
   `/api/e2e/verification-link` (404 outside a non-production deployment, 404 without a matching
   `x-e2e-secret`): `learning.spec.ts` drives the quiz form through the UI without hardcoding
   answers in the spec, where a content edit would silently break the test.
5. **Progress is a small user-scoped table, not audit data.** `lesson_progress` (migration
   `0052_lesson_progress.sql`): `(user_id, lesson_id)` primary key, `lesson_version`,
   `best_correct`, `total`, `first_passed_at`, `updated_at`; `user_id` cascades on delete. A
   lesson passed or retried is not portfolio or decision data (CLAUDE.md principle 5's
   exceptions), so it is deliberately outside the access-log's scope (ADR-0027); it still ships
   in the account data export (`LessonProgressDataExport`) and is deleted with the account
   through the existing FK cascade, with no extra deletion code. `LessonProgressRepository` is
   user-scoped per CLAUDE.md principle 5 and carries its own isolation test.
6. **All open in v1.** Every lesson is reachable regardless of progress; the lessons screen
   highlights the recommended next lesson as the first not-done lesson in Jornada order
   (`learning/grouping.ts`'s `nextLesson`). No unlock mode, no feature flag (KISS/YAGNI).
7. **A seventh rail destination.** "Aprender" (`GraduationCap`) joins the six existing
   destinations, after Diário and before Configurações, in all three layouts and the phone tab
   bar. `DESIGN.md`'s "six destinations" became "seven"; the radar stays a tab of Watchlist, not
   its own destination, unaffected by this count.

## Consequences

- `help/options-101.ts` and its section are deleted; the fixed illustrative market they defined
  now lives in `learning/illustrative-market.ts`, extended with a short call for the
  buying-vs-writing lesson. Any future lesson needing a new structure extends that module, not a
  per-lesson market.
- The six first-steps lessons (`what-is-an-option`, `calls-and-puts`, `strike-expiry-premium`,
  `buying-vs-writing`, `exercise-on-b3`, `reading-the-series-code`) are the only content PR 1
  ships; `fundamentals` through `advanced` exist as empty levels ("Em breve") until later tickets
  add their lessons.
- `exercise-on-b3` states B3's exercise-style convention ("most equity calls American-style, most
  equity puts European-style") and automatic exercise of in-the-money options at expiry
  cautiously, as a general rule rather than a per-series guarantee, because the registry's own
  `style` field (not the lesson) is each series' source of truth
  (`market-data/adapters/b3-instruments/parser.ts`).

## Deferred

- A first-run question asking the user's level, to pre-select where Jornada opens (Taful D25).
- Unlock modes gating a lesson on a prior one passing (Taful D24); v1 keeps everything open.
- Runtime AI help inside a lesson: out of scope for v1, and it would spend the user's own
  Anthropic key for something the lesson's own static text should already cover.

## Addendum (PR 2): Estruturas, the `structure` field and contextual links

1. **A third view, Estruturas.** `apps/web/src/app/(shell)/aprender?ver=estruturas` adds a third
   tab after Jornada and Temas: one row per structure lesson, grouped by the market view its own
   recipe expects (`modules/strategies`' `recipes`, read by `expectedMove`) in `alta`, `baixa`,
   `lateral`, `movimento forte` order — `learning/grouping.ts`'s `estruturasGroups`. It shares
   Jornada's progress map and `nextLesson` logic; it never duplicates them. This is the first
   place `learning` depends on `strategies`' entry point (`recipes`), a dependency `ARCHITECTURE.md`
   records.
2. **`structure` on a lesson.** `lessonSchema` gains an optional `structure`, closed to a new
   `recipeStructureIds` enum in `packages/contracts`' `lesson-catalog.ts` (named for the 12
   structures `modules/strategies/recipes.json` uses, a subset of the full strategy catalog's own
   structures). A content test pins that every structure id in `recipes.json` has exactly one
   lesson, and that `recipeStructureIds` itself matches the set `recipes.json` actually uses — so
   adding a thirteenth recipe structure without a lesson, or a lesson naming a structure no recipe
   uses, both fail a test rather than silently drifting. `level` and `topic` stay catalog-only
   (ADR-0081's original rule); `structure` lives on the lesson file itself because, unlike level
   and topic, it is a property of the lesson's own content (which structure it teaches), not of
   its place in a display order.
3. **One lookup, `lessonHrefForStructure`, always called server-side.** `learning/structure-link.ts`
   maps a structure id to its one lesson's URL, or `null` for a structure with no lesson (or an
   invalid id) — the only function any other module calls to link into a lesson; no other module
   reads `learning/catalog` or `learning/grouping` directly. It is exposed from `learning`'s
   `index.ts`, `learning`'s server-side entry point: a component reachable from a "use client"
   ancestor may never import it, since `index.ts` transitively pulls in the DB, auth and every
   lesson's own quiz answer key, which must never reach the browser bundle. A server component or
   server-only module (`modules/recipes/cards.ts`, `modules/plans/components/plan-screen.tsx`) may
   call it directly and pass the resulting `href` down as a prop. Where the consuming component
   sits behind a "use client" ancestor instead (`radar/components/research-idea-card.tsx`,
   re-exported from `radar/client.ts` for `decisions/components/research-panel.tsx`), the href is
   resolved once, server-side, where the idea's own DTO is built (`radar/research.ts`'s
   `ideaCardOf`, `decisions/research-view.ts`'s `ideaCardOfStored`) and carried as a plain
   `lessonHref: string | null` field on `IdeaCard`, never recomputed client-side.
4. **Contextual links, one shared component.** `learning/client.ts` exposes `StructureLessonLink`,
   a small, secondary-styled "Aprender: `<nome da estrutura>`" link client-safe component (no DB,
   auth or lesson-content import of its own) that renders nothing when its `href` prop is `null`.
   It is used in: the suggestion card's header (`radar/components/suggestion-card.tsx`, resolving
   `lessonHrefForStructure` itself since that file is server-only), the research idea card
   (`radar/components/research-idea-card.tsx`, reading the already-resolved `idea.lessonHref`), the
   recipe picker (`recipes/components/recipe-picker.tsx`, via `RecipeCard.lessonHref` resolved
   server-side in `recipes/cards.ts`), and the plan screen (`plans/components/plan-screen.tsx`,
   from the plan's own `structureId`, resolved server-side).
5. **Covered call's stock leg.** `learning/illustrative-market.ts` extends `priceOperation`'s
   known leg roles with `role: "stock"`, which the engine already supports (ADR-0081's own
   `priceOperation` surface, unchanged): the covered-call lesson's payoff example holds the stock
   and the call sold at a 1-to-1 proportion, which is the real B3 ratio (one option covers one
   share), not a simplification — a real 100-share lot of stock takes 100 calls sold against it,
   one lot of each.
6. **Two new placeholder families.** `breakEven<N>` (not just `breakEven0`) resolves any
   break-even index a multi-break-even structure (a butterfly, a condor, a straddle, a strangle)
   has, so a lesson can name both without inventing a number; `<exampleId>.thetaAbs` resolves
   `|OperationPricing.greeks.theta| × 100` — the per-lot magnitude of an example's own theta, not
   the raw per-share value, so it reads as a real lot's decay and never rounds away to R$0,00 for
   a cheap, far-dated option — used once, in the theta lesson. Both follow the existing rule:
   resolved only from engine output over the fixed illustrative market, never hand-written.
7. **The T+0 curve on every lesson chart.** `LessonBlocks`' `payoff-example` block now passes
   `payoffNow` to `PayoffChart` as well as `payoff` (ADR-0077), whenever the engine returns one,
   so the "reading a payoff diagram" and theta lessons can point at a real, engine-drawn T+0 line
   instead of describing it in the abstract.

## Addendum (PR 3): intermediate and advanced lessons, and the `delta`/`gamma`/`vega` placeholders

1. **A third placeholder family, delta and gamma unscaled, vega per lot, delta against `main`.**
   Against what was on `main` before this PR, `placeholders.ts` adds: `<exampleId>.delta` and
   `.gamma`, resolving `OperationPricing.greeks`' own field formatted by `formatDecimal` at four
   decimals (DESIGN.md's own rule for the bare ratio), sign kept, never taken as an absolute value
   or scaled ×100 into a per-lot magnitude — the delta and gamma lessons teach the per-option
   ratio directly, Hull's own convention, before any lot-sizing discussion. `.vega` is money
   (DESIGN.md: "vega em R$ / ponto"), but per lot rather than per share: the engine's own per-share
   value is scaled ×100 in `Decimal` first, the same order `thetaAbs` already used, and only then
   formatted with `formatPriceBRL` — scaling a value already rounded to the centavo would have
   compounded the rounding error well past a single cent (round 2 review, B1). A lesson's own
   prose states the "por lote" unit, never an instruction to multiply. Resolving the
   position-sizing lesson's own numbers from a declared risk profile, rather than hand-writing
   them, added five more tokens: `defaultDeclaredCapitalAbs`, `defaultMaxLossPerOperationPercent`
   and `defaultMaxLossCapAbs` (from `DEFAULT_RISK_PROFILE` and `riskLimitCentavos`, both exported
   from `modules/portfolio`'s client-safe entry point — `riskLimitCentavos` moved there from
   `modules/plans` so `learning` could read the same cap `plans`' own sizing uses, rather than
   recomputing it with a different rounding mode, round 2 review A10) and
   `<exampleId>.maxLossPerLotAbs` / `.maxLossLotsAtDefaultCap` (an example's own per-lot max loss,
   and how many whole lots, rounded down, that cap allows; both throw rather than render a
   nonsensical "∞" or "0 lotes" when the per-lot loss is non-positive or the cap allows fewer than
   one lot). `illustrative-market.ts`'s `ILLUSTRATIVE_EXPIRY` and `ILLUSTRATIVE_AT` constants are
   not exported: nothing outside the module needs them. A new pure `illustrativeSessionsThroughExpiry()`
   function is exported from the module, for its own fixture test, though not from either of
   `learning`'s entry points. Every new lesson reads greeks already computed for an existing example
   (the long call and long put for delta and gamma, the long and short call for vega, the iron
   condor for net portfolio greeks and position sizing), never a new leg combination or a second
   spot price.
2. **`intermediate` and `advanced` stop being empty levels.** Ten lessons placed by
   `content/catalog.json` fill both: `delta-and-gamma`, `vega-and-iv-changes`,
   `position-sizing-by-max-loss`, `rolling-a-position`, `corporate-events-on-b3` and
   `reading-a-fetha-suggestion` at `intermediate`; `portfolio-greeks`,
   `expiry-and-exercise-risk-on-b3`, `backtest-hygiene` and `the-decision-journal-and-scoring` at
   `advanced`. This closes the `risk` and `using-fetha` topics, both empty since PR 1. No code in
   `grouping.ts` or `LevelSection` ever special-cased "advanced" as the one level allowed to stay
   empty — the "Em breve" branch is `total === 0`, generic over any level — so filling it needed
   no code change, only content and the catalog entries.
