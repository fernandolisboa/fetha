---
status: accepted
date: 2026-10-26
---

# A suggestion is open through the next trading day, then archived (amends 0067)

## Context

ADR-0067 shows "Sugestões de hoje" as the suggestions of the radar's newest read session, with no
end. On 2026-10-26 the owner saw the same suggestion every day, dated 20/10: whenever the nightly
radar does not read a newer close, the newest suggestions it has stay on screen as "today's" for
as long as that lasts, priced at a close that is days old. The owner asked for the obvious
lifecycle: a suggestion nobody acts on is archived at the end of the day, and new ones come the
next day.

A suggestion is also a decision target scored at its scanned close (ADR-0067 item 5). A decision
recorded days later would be answered with hindsight the score cannot see.

## Decision

1. **A suggestion's window.** A suggestion scanned at session `S` is open through the São Paulo
   calendar day of the first trading session after `S` (from the shared calendar), including the
   evening of `S` itself and any weekend or holiday in between; from the next day on it is
   archived. When the calendar does not reach the next session yet, the window ends on `S`'s own
   day. The rule is a pure function (`suggestionWindow` in `modules/radar/suggestion-window.ts`);
   "today" is `todaySaoPauloDate()`. Nothing is stored: archiving is derived on every read, so no
   migration and no nightly step.
2. **Today's suggestions.** The panel shows the newest read session's suggestions only while their
   window is open. Once archived, the panel says which close they came from and when they were
   archived, and never falls back to anything older; nothing shows until the radar reads a newer
   close.
3. **Archived is read-only.** An archived suggestion keeps its page (`/sugestoes/[id]`, badge
   "Valeu até <data>"; an open one shows "Vale até <data>"), the recipe, the builder link and
   analyses, and is still scored at its horizon for the journal's calibration panel. It no longer
   takes a decision: the card shows that it was archived, and `recordDecisionAction` answers
   `archived` for one, so a page left open past midnight cannot record it either. A decision
   recorded while the suggestion was open stays as it is.
4. **E2E clock.** The e2e suite only ingests fixed past sessions, so `E2E_TODAY` (a `YYYY-MM-DD`)
   pins the window's "today" outside production; it is ignored on a production deployment and
   against the production database, like `E2E_B3_INSTRUMENTS_DIR`. CI sets it to the session
   after the newest fixed one.

## Consequences

- A stalled radar now shows as "no suggestions today" instead of the same suggestion day after
  day; the radar tab still shows its newest read session with its date, as before.
- The window is computed per request (one calendar read), like the risk check on each card.
- Analyses of an archived suggestion stay allowed: they read the stored lot and the facts of its
  close, never later prices, and the owner may want to learn from an old one.

## Considered options

- An `archived_at` column written by the nightly job: a migration and a write for a fact the
  calendar already answers, and it would not archive anything while the nightly job is the thing
  that stalled.
- Archive at the next session's close (18:00) instead of the end of the day: the owner asked for
  the end of the day, and the evening is when the nightly job brings the new ones anyway.
- Keep showing stale suggestions with a warning: the owner asked for them to leave the panel.
