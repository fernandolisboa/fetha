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
2. **The setting.** `preferences.suggestion_archive_after_hours` (null = off, the default) takes
   12, 24, 48, 72 or 168 hours, chosen in Configurações › Aparência › Sugestões já vistas.
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
  first time it shows afterwards. Turning the option off keeps the sightings already recorded
  until their suggestion or the account is deleted.
- No new decision lock: the hindsight argument of ADR-0072 does not apply, the suggestion's own
  close is still the newest.

## Considered options

- Record the sighting when the server renders the panel: a render is not a view (prefetches,
  revalidations after an unrelated action), and the delay would start before the user looked.
- A per-user `archived_at` written when the delay passes: a write for a fact the sighting and the
  setting already answer, and it needs a job.
- Any delay in free form: a handful of fixed choices keeps the setting one tap and the copy plain.
