---
status: accepted
date: 2026-10-26
---

# A suggestion the user has seen leaves their panel after a delay they choose (amends 0066, 0067)

## Context

With suggestions archived only when the radar reads a newer close (ADR-0073), a stalled nightly
job can keep the same suggestions on "Sugestões de hoje" for days. On 2026-10-26 the owner asked
for a per-user option: once a user has already seen a suggestion, archive it for them after some
time, with automatic archiving on or off and the delay chosen by the user.

## Decision

1. **A sighting.** While the user has automatic archiving on, the first time enough of a
   suggestion's card is on their screen while the page is visible (half of the card, or half of
   the screen for a card taller than two screens; today's suggestions on either tab, or the
   suggestion's page), the browser records it: `suggestion_sightings` keeps one row per user and
   suggestion with `first_seen_at`, and a later sighting never moves it. The Server Action
   `markSuggestionsSeenAction` takes at most 100 suggestion ids, records only ids of stored
   suggestions, and records nothing while the option is off (data minimization: with the option
   off the sighting has no purpose). It is user data like a decision: user-scoped (isolation
   test), in the account export, deleted with the account, gone when its suggestion is, and
   listed in the privacy policy (terms version 2026-10-26.1). `radar` thus owns one user-scoped
   table next to its reference data (amending ADR-0066 item 2 and ADR-0067's "no user_id").
2. **The setting.** `preferences.suggestion_archive_enabled` (off by default) and
   `preferences.suggestion_archive_after_minutes` (1440 by default, a check keeps it between one
   minute and one year). The user types a whole number and picks minutes, hours, days or weeks in
   Configurações › Aparência › Sugestões já vistas, or taps a shortcut (12 hours, 1 day, 3 days,
   1 week); the server converts it to minutes and the screen shows it back in the largest unit
   that divides it exactly. Turning the option off keeps the delay, so turning it back on restores
   it.
3. **The rule.** With a delay set, a suggestion leaves that user's "Sugestões de hoje" once the
   delay has passed since its first sighting; one never seen stays. A pure function decides it
   (`splitSeenSuggestions` in `modules/radar/seen-archive.ts`) on every read; nothing is written
   when the delay passes.
4. **What it changes, and what not.** It is a view of the panel for one user, not ADR-0073's
   archiving: the suggestion still takes a decision while it is open, keeps its page and is
   scored for everyone. The panel lists the ones it took off as links to their pages, says so
   when it took off all of them, and always says how the option is set, with a link to change it.

## Consequences

- One user-scoped write per batch of cards that come on screen; none when nothing new shows.
- Sightings start when the option is turned on: a suggestion seen before that counts from the
  first time it shows afterwards. Turning the option off erases the user's sightings
  (`setSuggestionArchiveAction`, owned by `radar` since `preferences` cannot depend on it; the
  settings page passes it to the picker).
- No new decision lock: the hindsight argument of ADR-0072 does not apply, the suggestion's own
  close is still the newest.

## Considered options

- Record the sighting when the server renders the panel: a render is not a view (prefetches,
  revalidations after an unrelated action), and the delay would start before the user looked.
- A per-user `archived_at` written when the delay passes: a write for a fact the sighting and the
  setting already answer, and it needs a job.
- A handful of fixed delays (12, 24, 48, 72, 168 hours): the first version of this ADR; the owner
  asked for a typed value with its unit instead, and the shortcuts keep the common ones one tap.
- Months as a unit: their length varies, and a week count covers the range up to a year.
- Null delay meaning off: a separate flag keeps the chosen delay when the user pauses the option.
