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

- The "Estruturas" view (one lesson per structure) and contextual links from elsewhere in the app
  into a lesson (PR 2).
- A first-run question asking the user's level, to pre-select where Jornada opens (Taful D25).
- Unlock modes gating a lesson on a prior one passing (Taful D24); v1 keeps everything open.
- Runtime AI help inside a lesson: out of scope for v1, and it would spend the user's own
  Anthropic key for something the lesson's own static text should already cover.
