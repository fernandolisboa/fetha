---
status: accepted
date: 2026-10-23
---

# A third layout, Dock, floats the navigation over the page (amends 0069)

## Context

ADR-0069 shipped two layouts: Workspace (left rail in its own column) and Studio (tabs in the
header, a bottom status bar). On 2026-10-23 the owner asked for one more layout "with a floating
menu". The owner works on large desktop monitors and wants every screen to use the full width
(2026-10-16), so the new layout should give the page as much width as possible while keeping the
six destinations one click away.

## Decision

1. **`dock` is a third value of `preferences.layout`** (`workspace` | `studio` | `dock`), picked in
   Configurações › Aparência like the others. The column is plain `text` with no check constraint
   (migration 0044), so no migration is needed; unknown values still fall back to `workspace`.
2. **From 768px up the destinations float in a panel over the page's left edge** (`Dock` in
   `modules/shell`): fixed 12px below the header and 12px from the left edge, radius twice the
   theme's `--radius` (square themes stay square), a hairline border and a shadow. At rest it is
   50px wide with icons only, the label as each link's accessible name and `title`; from 1024px it
   widens to 200px over the content to show the labels and the declared capital while the pointer
   is on it or a keyboard focus (`:focus-visible`) is inside. It never reflows the page: `<main>`
   keeps a left gutter the width of the resting dock plus its inset, and the widened dock
   overlaps the page instead of pushing it. The header and its market bar stay as in Workspace;
   there is no rail column, collapse button or status bar.
3. **The floating shadow is a shell variable, not a theme token**: `--shell-float-shadow` (with
   `--shell-float-inset` and `--shell-dock-width`) in the base layer of `globals.css`, a dark
   shadow by default and a warm, lighter one for `papel`. Themes keep `--elevation: none`; DESIGN.md
   still says hairlines instead of shadows everywhere except a surface that floats over the page.
4. **Under 768px Dock keeps the shared phone shell, but its tab bar floats too**: the same six
   cells in a rounded panel 12px from the screen edges (inside the safe-area insets), and the page
   keeps a gutter of the bar's 56px plus twice the inset. Workspace and Studio keep the
   edge-to-edge bar.
5. **The tour finds the dock**: the navigation steps try the rail, the dock, the header tabs and
   the tab bar, in that order, and anchor to the first one on screen.

## Considered options

- A horizontal dock centered at the bottom (macOS style): frees the left edge too, but it would
  sit over the bottom of every table and the decision bar, the very place the owner reads and acts;
  a left panel only covers a gutter the page already leaves.
- A dock that only expands on click and remembers it (like the rail's collapse): duplicates
  Workspace's collapsed rail; the point of a floating menu is that it takes no width either way.
- Expanding on any focus inside, not just `:focus-visible`: a mouse click leaves focus on the link
  after navigation, so the dock would stay wide over the page until the next click elsewhere.
- Floating the header as well: the header holds search, market bar and account menu at full
  width; floating it would cost width and height for no navigation gain.
