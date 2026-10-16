---
status: accepted
date: 2026-10-16
---

# Two layouts, Workspace and Studio, and four themes carried over from Bardo and Mascate (amends 0015)

## Context

The owner's two other apps, Bardo and Mascate, share one appearance model: ten interface themes in
three families (base, high contrast, terminal) and two layouts, **Workspace** (a sidebar by area,
roomy pages) and **Studio** (denser: destinations as tabs on top, compact headers, a status bar).
On 2026-10-16 the owner asked for new themes and a new layout in Fetha, using those two apps as the
example. ADR-0015 had ruled out layouts that move the shell ("Fetha is desktop-first with one
shell") and light themes ("not at launch").

## Decision

1. **Four themes from Bardo and Mascate**, each a token set like the first three (ADR-0015's
   model is unchanged: a theme never moves anything): `grafite` (Bardo's Graphite: dark, amber
   accent, the system font with IBM Plex Mono numbers, 6px radius), `ouro-negro` (Black Gold:
   black and gold, all JetBrains Mono, square, gold-tinted hairlines), `fosforo` (Phosphor: green
   phosphor terminal, all JetBrains Mono, square) and `papel` (Paper: the first light theme). The
   palettes are Bardo's own values mapped onto Fetha's tokens; where Fetha uses one token for two
   jobs, the stricter use wins: `papel`'s `--accent` is Bardo's darker amber text color (`#9a5800`)
   rather than its bright fill, because the same token colors links and the active destination
   and must keep 4.5:1 on the paper ground. Bardo's gains color in Phosphor is teal, so
   `fosforo`'s `--up` is teal and its green stays the action accent. The contrast and token tests
   cover every theme automatically.
2. **Each theme declares `color-scheme`** (`dark`, or `light` for `papel`), so scrollbars and native
   controls follow the theme; `themeMode` in `modules/preferences/theme.ts` is the source the
   test checks it against.
3. **A layout is a per-user preference next to the theme**: `preferences.layout`
   (`workspace` | `studio`, default `workspace`, migration 0044), set from Configurações ›
   Aparência with `setLayoutAction`, applied as `data-layout` on `<html>` and read by `AppShell`.
   Unknown stored values fall back to `workspace`, like themes.
4. **Studio places the same parts differently, from 768px up**: the six destinations become tabs
   in the header (`TopNav`, labels from 1280px, icons below), the rail is not rendered, the market
   bar moves from the header to a 28px status bar fixed at the bottom with the unread-signal
   count, and `PageHeader` sets the overline and the headline on one compact line through a
   `studio:` Tailwind variant. Under 768px both layouts are the same phone shell (header market
   bar, bottom tab bar). Pages, page containers and their widths are not layout-specific.
5. **The tour follows the layout**: its navigation steps target the rail, then the header tabs,
   then the tab bar, whichever is on screen.

## Considered options

- Port all ten themes: the high-contrast pair and the light variants of the terminal themes
  (Brass, Phosphor Light) and Sand/Slate add little for one owner on a dark desktop; four covers
  each family Bardo has (base dark, terminal, light). More are one token block each.
- "Follow the system" light/dark pairing, as Bardo and Mascate do: needs a client script before
  first paint (the CSP takes a nonce, ADR-0035) and charts that re-read tokens on change; left
  out until a second light theme exists.
- A per-theme PWA manifest: `manifest.ts` keeps the dark `background_color` and `theme_color`, so
  an installed app shows a dark splash and title bar around `papel`; the manifest is per app and
  cached, so following the theme there is left out with "follow the system".
- Studio's tabs in a second header row: costs 36px of height on every screen for no gain at
  desktop widths, where one row fits wordmark, tabs, search and account.
