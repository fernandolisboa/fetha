---
status: accepted
date: 2026-09-28
---

# The guided tour is hand-built on the Popover and its dismissal lives in preferences (#231)

## Context

The owner asked for a guided tour that dims the screen, focuses one component per step and tells
the user where to click, with a dismiss that some users will take and that must stay taken. Three
choices had no precedent: which library draws the tour, where "dismissed" is stored, and when the
tour starts.

## Decision

- **No tour library.** The step card is the shadcn `Popover` (Base UI), anchored to the step's
  element through the Positioner's `anchor` prop, modal, with `PopoverClose` as "Pular tour" and
  "Concluir". The dim layer is one fixed element whose `box-shadow` cuts out the target's rect. It is black
  at 60% in every theme, heavier than the Dialog backdrop, because everything but one element must
  recede.
  Tour libraries (driver.js, shepherd, react-joyride) inject their own styles and dialog markup:
  the first fights the enforced nonce CSP (ADR-0035), the second the rule that interactive
  primitives come from shadcn.
- **Targets are `data-tour` attributes** on shell and watchlist elements (`rail`, `tab-bar`,
  `add-instrument`, `account-menu`) and the rail's and tab bar's own links, selected by their typed
  destination href. `data-tour="<name>"` is the contract between a module's markup and the tour;
  renaming or removing one means updating `help/tour-steps.ts`. A step lists its targets in order
  of preference and anchors on the first one on screen: the navigation steps try the rail, then
  the bottom tab bar that replaces it under 768px (#243). A step with no target on screen (the
  watchlist's button on another page) shows centered with a full dim.
- **Dismissal is `preferences.tour_dismissed_at`**, per user, nullable, written by
  `dismissTourAction` on "Pular tour", Escape and "Concluir". It keeps the first timestamp. Not
  `localStorage`: the installed PWA and a second browser must agree, and a cleared site data must
  not bring the tour back. The value is an interface preference, covered by the privacy policy's
  "preferências de tema e de layout", exported with the rest of `preferences` and deleted with the
  account.
- **Auto-start** on any signed-in shell load while the column is null, existing accounts included,
  600ms after mount so the redirect that lands a new account on the shell has settled.
- **Replay** from `/como-usar` ("Refazer o tour") navigates to the watchlist and starts the tour on
  the client without clearing the column.
- Steps name only features that work today; `Ctrl K` search stays out until #233 wires it.

## Consequences

- A new shell element worth pointing at gets a `data-tour` attribute and a step in
  `help/tour-steps.ts`; the e2e `tour.spec.ts` walks every step.
- Every e2e spec except `tour.spec.ts` imports `test` from `e2e/tour.ts`, whose page fixture skips
  the tour like a user would; `registerAndSignIn` closes it with Escape before the spec starts.
