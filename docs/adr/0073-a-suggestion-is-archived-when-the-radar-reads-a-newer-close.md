---
status: accepted
date: 2026-10-26
---

# A suggestion is archived when the radar reads a newer close (supersedes 0072)

## Context

ADR-0072 archived a suggestion at the end of the São Paulo day of the trading session after its
close. The same day the owner pointed out the gap: ingestion does not run every night (B3 can be
late, a file can be malformed, the IV index may not be ready), and on those days the wall-clock
rule empties the panel while the newest suggestions are still the newest the radar has. The owner
asked to archive only when there is a newer ingestion, and to show how old the suggestions are
while ingestion lags. Archiving suggestions a user has already seen, configurable per user, and a
button that looks for suggestions on demand are separate work.

## Decision

1. **Superseded, not expired.** A suggestion scanned at session `S` is open while `S` is the
   newest session the radar has read (at least one non-null reading, the same session the radar
   tab and the cards show), and archived once the radar has read any later close. The date alone
   archives nothing. The rule is a pure function (`suggestionValidity` in
   `modules/radar/suggestion-validity.ts`); nothing is stored, so no migration and no nightly step.
2. **Today's suggestions.** The panel always shows the newest read session's suggestions. When
   later closes are overdue, a warning says how many the radar has not read yet ("O radar ainda
   não leu os 3 fechamentos seguintes. Os preços de hoje podem ter mudado."). A close counts as overdue 18 hours after it
   (past the nightly job's last attempt at 09:00 UTC the next morning), so the normal evening gap
   between a close and the nightly scan never shows a warning.
3. **Archived is read-only**, as in ADR-0072: the page stays (badge "Arquivada desde o fechamento
   de <data>"; an open one shows "Em aberto"), analyses stay allowed, the score at the horizon is
   unchanged, and `recordDecisionAction` answers `archived`. A decision recorded while it was open
   stays.
4. **No e2e clock.** `E2E_TODAY` existed only for the wall-clock window and is removed. The
   Playwright `radar` project runs after the `owner` project, whose nightly runs could otherwise
   read a newer close and archive the seeded suggestion mid-spec. The overdue count is covered by
   integration tests, not e2e, since it depends on the time of day.

## Consequences

- A stalled radar shows the last suggestions with their age instead of an empty panel, and a
  decision on them is still allowed: it is scored at the close the suggestion was priced at, so a
  late decision is recorded against that close and the warning tells the user prices have moved.
- The panel costs one more count over the calendar per request.
- The newer close archives as soon as the radar reads its first underlying, so while a scan is
  resumed across nightly runs the panel shows that session's partial set, as the radar tab does.
- The count only sees sessions already in the calendar; a stall across the new year before the
  next year's calendar is ingested undercounts.
- A radar night that reads a newer close with no match empties the panel, as ADR-0067 intended
  ("no recipe found an entry").

## Considered options

- Keep ADR-0072's end-of-next-day rule and add the age warning: the owner asked for archiving to
  follow ingestion, not the clock.
- Store an `archived_at` written by the nightly scan: a migration for a fact the newest read
  session already answers.
