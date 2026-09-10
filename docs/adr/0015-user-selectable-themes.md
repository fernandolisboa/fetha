---
status: accepted
date: 2026-09-09
---

# Themes are per-user token sets; component anatomy is never themed

Each user picks a theme in Configurações, stored on their account and applied as `data-theme` on
`<html>`. A theme is a CSS variable set (color, type, radius, elevation, density) plus nothing
else: the app shell, page anatomy, tables, charts and notices are the same components in every
theme. Three themes ship at launch, born from the three directions explored in Phase 3:
`instrumento` (default: sans labels, mono numbers, cyan action accent, amber reserved for risk),
`terminal` (all monospaced, square, near-black, amber accent) and `amplo` (serif headlines, more
air, warm palette, gold accent). Adding a theme is adding a token set and passing the contrast
test; no component changes. Same model as Feudo's themes, so the two repos share the pipeline.

The choice, and the rail's collapsed/expanded state, are stored in the `preferences` module
(`apps/web/src/modules/preferences`): a single `preferences` table (`user_id` unique, `theme`,
`rail_collapsed`), reached only through `PreferencesRepository`, a `UserScopedRepository`
constructed from the live session via `modules/auth/session.ts`'s `forCurrentUser` (docs/adr/0016).
`[data-theme="x"]` selectors in `globals.css` are not scoped to `:root`, so a themed swatch can
nest inside a page styled by a different theme (the theme picker's own preview).

## Considered options

- One fixed theme: simpler, but the owner wants the choice and the exploration already produced
  three coherent sets.
- Themes that also change layout (rail vs top nav) as Feudo allows: unnecessary here; Fetha is
  desktop-first with one shell.
- Light mode: not at launch; the direction is dark by design, and a light theme is one more token
  set when wanted.
