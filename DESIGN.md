# Fetha — Design

Canonical design reference. Visual truth for every screen; `CLAUDE.md` mirrors the token summary
so `/design` and `/design-sync` agree with this file. Mockups: the Fetha Workstation design canvas
(three theme artboards of the structure/payoff screen inside the shell, desktop 1440×900).

## Direction

A dense, data-first workstation for one person deciding about their own money. Dark by default,
numbers first: tabular figures everywhere, monospaced numerals, tight vertical rhythm, hairlines
instead of shadows, one accent for actions and a separate, reserved color for risk. Hierarchy
borrowed from good trading and analytics layouts; nothing copied. Not a fintech landing page.

## Structure (one set of components per layout; themes change tokens, never anatomy)

- **App shell**: a CSS grid with named areas (header, nav, content). Header 48px: wordmark,
  command search (`Ctrl K`: instrument, option series or strategy; a series opens its own page,
  `/opcoes/<ticker>`), market bar (IBOV, CDI, the focused instrument's last price and change, data
  freshness: "14:32 · cotação com atraso de 5 min" or "fechamento de ontem"), account menu. Nav: a
  left rail, 200px with icons and labels, 56px collapsed with icons only, state remembered per
  user; six destinations: Watchlist, Sinais (with an unread count), Estratégias, Carteira, Diário,
  Configurações; declared capital at the rail foot. The radar (ADR-0066) is a tab of the
  Watchlist page (`/?aba=radar`), never a seventh destination. Configurações is split into tabs, each with its own URL
  (`/configuracoes/<aba>`): Aparência, Risco, IA, Conta and, for the owner only, Administração;
  `/configuracoes` opens Aparência and links about a missing risk profile open Risco. Under 1024px the rail collapses; under 768px
  it becomes a 56px bottom tab bar (rare: desktop first): six equal icon-only cells, like the
  collapsed rail, the active one in `--accent` with a 2px top line, Sinais' unread count as a
  small accent pill; it is fixed to the viewport bottom and the page keeps a gutter its height.
  Installed on a notched phone (`viewport-fit=cover`), the page is inset by
  `env(safe-area-inset-*)`: the header's and the tab bar's surfaces extend under the status bar,
  the home indicator and the side insets, while their contents stay inside; the tab bar's cells
  stay 56px tall, and the gutter below the content is the shell's 56px plus the body's bottom inset.
  From 768px up the header is pinned to the top of the viewport and the rail sits right under it at
  the viewport's remaining height, scrolling on its own if it ever overflows, so navigation and the
  rail foot stay on screen; the page keeps the document's scroll. The rail foot shows only when the
  rail has labels: collapsed or under 1024px it is icons only.
  The header never scrolls sideways: under 1024px the account menu shows only its avatar and the
  market bar drops the freshness phrase; under 768px the command search becomes a 44px icon button
  and the account avatar a 44px target.
- **Page**: overline (context · source) + headline naming the object ("Collar em PETR4"), status
  chips (expiry and sessions left, pricing model), primary and secondary actions on the right.
  Content is a two-column grid `minmax(0,1fr) 320px`: work on the left (tables, charts), results
  and risk on the right. Sections are hairline-bordered panels with a 13px title row.
- **Data**: tables with an 11px uppercase header row, hairline-ruled rows (height set by
  `--density`), numbers right-aligned in
  `--font-mono` with tabular figures, buy/sell side colored by `--up`/`--down`; stat blocks
  (label, 18px value, 12px sub) stacked with hairlines; greek rows as label/value pairs; notices as
  bordered panels with an icon and one action; charts fill their panel.
- **Actions**: one primary button per screen (accent fill), secondary as outlined, tertiary as
  text. Recording a decision is its own bar (Entrar · Não entrar · Manter · Ajustar · Sair) with
  the horizon stated next to it; on a single-object screen (a signal, an operation) the bar sits
  inline. On list screens (Sinais, Carteira) each unanswered row opens the same bar from a
  per-row "Registrar decisão" trigger inside a Dialog, the kind buttons and the horizon field
  both inside the form; an answered row shows the recorded kind and date instead of the trigger.
  Requesting an analysis is the header's primary action.
- **Themes** are per-user (`data-theme` on `<html>`, chosen in Configurações › Aparência): three
  at launch, `instrumento` (default), `terminal`, `amplo`, and four carried over from the owner's
  Bardo and Mascate apps (ADR-0069), `grafite`, `ouro-negro`, `fosforo` and `papel`, the one light
  theme. A theme changes color, type, radius, elevation, density and `color-scheme`; every
  component keeps its anatomy (ADR-0015).
- **Layouts** are per-user too (`data-layout` on `<html>`, chosen in Aparência, ADR-0069). The
  shell above is **Workspace** (default). **Studio**, from 768px up, puts the six destinations in
  the header as tabs (icon and label from 1280px, icon only below, the active one boxed in
  `--accent` on `--accent-soft`, Sinais' unread count as a pill), renders no rail, moves the market
  bar into a 28px status bar fixed to the bottom (unread-signal count on the left, market bar on
  the right; the page keeps a gutter its height) and sets the page's overline and headline on one
  line, the headline at 18px. Under 768px both layouts are the same phone shell. A layout never
  changes a page's content or width.

## Tokens

Themes are CSS variable sets. Values are sRGB hex. Text tokens meet 4.5:1 on both `--bg` and
`--surface`; chart and semantic colors meet 3:1 on `--bg`; `--faint` is used only at 11–12px
uppercase or metadata and meets 4.5:1 on `--bg` and `--surface`.

### Instrumento (default)

| token            | value                                                | use                                             |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `--bg`           | `#0f1115`                                            | page background                                 |
| `--surface`      | `#151922`                                            | header, rail, panels                            |
| `--surface-2`    | `#1a1f29`                                            | selected nav, chips, skeletons, inputs          |
| `--line`         | `#262c38`                                            | panel borders, section rules                    |
| `--line-soft`    | `#1f2430`                                            | table row rules, chart grid                     |
| `--ink`          | `#e6e8ee`                                            | primary text, primary values                    |
| `--muted`        | `#8d97a8`                                            | secondary text, axis labels                     |
| `--faint`        | `#7a8598`                                            | overlines, metadata                             |
| `--accent`       | `#3fb8c8`                                            | primary action, links, active nav, focus ring   |
| `--accent-hover` | `#62c9d6`                                            |                                                 |
| `--accent-ink`   | `#06181b`                                            | text on accent                                  |
| `--accent-soft`  | `#12303a`                                            | selected rows, accent chip background           |
| `--up`           | `#2fb36a`                                            | buy side, gains, up candles, payoff above zero  |
| `--down`         | `#e0524f`                                            | sell side, losses, down candles, payoff below   |
| `--warning`      | `#e0a83a`                                            | risk-profile warnings, stale data, late signals |
| `--danger`       | `#f0665f`                                            | destructive actions, errors                     |
| `--greek-delta`  | `#3fb8c8`                                            | delta series and labels                         |
| `--greek-gamma`  | `#b688e6`                                            | gamma                                           |
| `--greek-theta`  | `#e0a83a`                                            | theta                                           |
| `--greek-vega`   | `#6f9cf0`                                            | vega                                            |
| `--font-display` | `"IBM Plex Sans", "Segoe UI", system-ui, sans-serif` | headlines, section titles                       |
| `--font-body`    | `"IBM Plex Sans", "Segoe UI", system-ui, sans-serif` | everything else                                 |
| `--font-mono`    | `"IBM Plex Mono", Consolas, monospace`               | every number, ticker, date and time             |
| `--radius`       | `4px`                                                | controls, panels (chips 3px, avatars round)     |
| `--elevation`    | none                                                 | hairlines only                                  |
| `--density`      | body 13px, row 36px, panel padding 10px 12px         |                                                 |
| `--chart-stroke` | `--accent`                                           | payoff and equity lines                         |
| `--series-1`     | `#3987e5`                                            | first run in a comparison                       |
| `--series-2`     | `#d95926`                                            | second run in a comparison                      |
| `--series-3`     | `#199e70`                                            | third run in a comparison                       |

`globals.css` also derives implementation-only aliases of `--density` per theme —
`--text-overline`, `--text-meta`, `--text-body`, `--text-input`, `--text-stat`, `--text-headline`,
`--text-hero` (the type scale below, already scaled by density), `--row-height` and
`--panel-padding` — so components read a concrete size instead of recomputing it from `--density`
at each call site. They are not part of the token contract itself: a fourth theme only has to set
`--density` and these seven text steps plus `--row-height`/`--panel-padding` consistently with it,
the same way Terminal and Amplo do today.

### Terminal

`--bg #0a0b0d` · `--surface #0a0b0d` · `--surface-2 #111317` · `--line #22262c` · `--line-soft
#181b20` · `--ink #d7d9de` · `--muted #8a9099` · `--faint #747b85` · `--accent #e0a83a` ·
`--accent-hover #f0bd5c` · `--accent-ink #15120a` · `--accent-soft #2a2110` · `--up #3ddc84` ·
`--down #ff5c5c` · `--warning #e0a83a` · `--danger #ff5c5c` · greeks delta `#e0a83a`, gamma
`#b0b6c0`, theta `#f0bd5c`, vega `#7d8794` · display, body and mono `"JetBrains Mono"` · radius
0 · elevation none · density: body 12px, row 32px, panel padding 8px 10px · `--chart-stroke
--ink` (the accent is reserved for the primary action and risk).

### Amplo

`--bg #13151b` · `--surface #191c24` · `--surface-2 #1f232d` · `--line #2a2f3b` · `--line-soft
#232833` · `--ink #ebe7dd` · `--muted #a39d90` · `--faint #8c8679` · `--accent #c9a25a` ·
`--accent-hover #dcb66c` · `--accent-ink #1a1509` · `--accent-soft #2f2916` · `--up #6fbf8f` ·
`--down #d9776f` · `--warning #c9a25a` · `--danger #e0736a` · greeks delta `#c9a25a`, gamma
`#b494cf`, theta `#e0b46b`, vega `#7fa3c2` · display `"Source Serif 4", Georgia, serif` · body
`"Source Sans 3", "Segoe UI", system-ui, sans-serif` · mono `"Source Code Pro", Consolas,
monospace` · radius 8px · elevation none · density: body 14px, row 40px, panel padding 12px 14px ·
`--chart-stroke --ink`.

### Grafite

Bardo's Graphite. `--bg #0f1113` · `--surface #16191c` · `--surface-2 #1e2226` · `--line #2a2f35` ·
`--line-soft #202428` · `--ink #e7e9ec` · `--muted #a3aab3` · `--faint #8a929c` · `--accent #f2a33a`
· `--accent-hover #f5b661` · `--accent-ink #1a1206` · `--accent-soft #2c2416` · `--up #4cc38a` ·
`--down #f0716a` · `--warning #e5c454` · `--danger #f0716a` · greeks delta `#f2a33a`, gamma
`#b688e6`, theta `#e5c454`, vega `#6cb2f5` · display and body `"Segoe UI", system-ui, sans-serif` ·
mono `"IBM Plex Mono"` · radius 6px · density as Instrumento · `--chart-stroke --accent`.

### Ouro Negro

Bardo's Black Gold. `--bg #0d0d0d` · `--surface #121212` · `--surface-2 #1d1a12` · `--line #4a3d22`
(gold-tinted hairlines) · `--line-soft #2b2618` · `--ink #e0dfdb` · `--muted #a89c84` · `--faint
#8f846e` · `--accent #d4af37` · `--accent-hover #dfc05a` · `--accent-ink #0d0d0d` · `--accent-soft
#282003` · `--up #a3c46b` · `--down #e06c6c` · `--warning #f59e0b` · `--danger #e06c6c` · greeks
delta `#d4af37`, gamma `#b4a6d6`, theta `#f59e0b`, vega `#8db8d0` · display, body and mono
`"JetBrains Mono"` · radius 0 · density as Terminal · `--chart-stroke --ink`.

### Fósforo

Bardo's Phosphor. `--bg #040a06` · `--surface #08110b` · `--surface-2 #0f2216` · `--line #1d4f30` ·
`--line-soft #163220` · `--ink #cbf7d5` · `--muted #86dba0` · `--faint #62b57f` · `--accent #3df57a`
· `--accent-hover #6cf89a` · `--accent-ink #02100a` · `--accent-soft #0b2c16` · `--up #5fe0d0`
(teal: green is the action accent) · `--down #ff6b78` · `--warning #e8d35a` · `--danger #ff6b78` ·
greeks delta `#3df57a`, gamma `#c59bf0`, theta `#e8d35a`, vega `#6cc8ff` · display, body and mono
`"JetBrains Mono"` · radius 0 · density as Terminal · `--chart-stroke --ink`.

### Papel (light)

Bardo's Paper. `--bg #f2f2ef` · `--surface #ffffff` · `--surface-2 #ecece8` · `--line #dcdcd7` ·
`--line-soft #e9e9e5` · `--ink #17181a` · `--muted #4a4e54` · `--faint #5f646b` · `--accent #9a5800`
(Bardo's amber text color: the token also colors links and must keep 4.5:1) · `--accent-hover
#7f4800` · `--accent-ink #ffffff` · `--accent-soft #fbead0` · `--up #1c7a3d` · `--down #bf2f28` ·
`--warning #7f5b00` · `--danger #bf2f28` · greeks delta `#9a5800`, gamma `#7b4bb8`, theta
`#7f5b00`, vega `#1f5fb0` · display and body `"Segoe UI", system-ui, sans-serif` · mono `"IBM Plex
Mono"` · radius 6px · density as Instrumento · `--chart-stroke --accent` · `color-scheme: light`.

### Type scale (px, Instrumento values)

11 overline (uppercase, 0.06em tracking) · 12 meta · 13 body and panel title · 15 inputs · 18 stat
value (mono) · 22 page headline (display) · 26 hero value (mono, e.g. equity). Overline and meta
are fixed; the other steps scale with the theme's density factor (Terminal 0.95, Amplo 1.06,
rounded to whole px), which is how the three artboards differ. Numbers always
`font-variant-numeric: tabular-nums` in `--font-mono`.

### Spacing and layout

4px base: 4, 6, 8, 10, 12, 14, 16, 20, 24, 32. Page padding 16px 20px. Panel gap 14px. Content
grid `minmax(0,1fr) 320px`, stacked when the content area is too narrow for both. Pages fill the
content area at every width: no page sits in a centered max-width column, and only running prose
is held to 72ch. Charts fill their panel width; payoff keeps a 800×340 aspect up to 420px tall,
equity and drawdown a fixed height. Hit targets ≥ 32px desktop in every theme, table row actions included, ≥ 44px on
touch.

### Motion

120ms ease-out on hover and focus; 180ms ease-in-out on rail collapse and panel open; chart lines
draw once on first paint (300ms); live values flash `--accent-soft` for 400ms on change.
`prefers-reduced-motion`: no draw and no flash.

## Chart palette and rules

Follow the dataviz method. Candles: `--up` and `--down` bodies with wicks in `--muted`; volume
bars in `--surface-2`; overlays (SMA, EMA) in `--greek-vega` and `--greek-gamma`; indicator panes
below the price with their own y scale. Payoff: line in `--chart-stroke`, gain area `--up` at 12%
opacity, loss area `--down` at 12%, zero line dashed `--muted`, spot as a dotted vertical rule in
`--ink`, break-evens as hollow markers with labels, max loss and max gain labeled in their color.
Equity curve in `--chart-stroke` with drawdown as a `--down` area below; distribution of returns
as `--surface-2` bars with the zero bin marked. Greeks by their tokens, never by `--up`/`--down`.
Risk bands: within limit `--up`, near limit (≥ 80%) `--warning`, breach `--down`. Grid recessive
(`--line-soft`), axis labels `--muted` 11px mono, direct labels only for extremes and break-evens.
Never dual axes, never pie charts. A comparison of backtest runs draws each run's cumulative
return (`equity / initialCapital − 1`) on one percentage axis, one line per run in `--series-1`,
`--series-2`, `--series-3` in run order, with a dashed `--muted` zero line, a legend above, a
direct label at each line's end and a crosshair tooltip; three runs at most, the size at which the
three series tokens separate every pair under colour-vision deficiency (ADR-0023). The series
tokens are the same in every theme and never stand for gain, loss or risk.

## Component inventory

shadcn/ui primitives (mandatory, restyled by tokens): Button, Input, Label, Select, Combobox
(instrument and series search), Tabs, Dialog, DropdownMenu, Popover, Tooltip, Toast, Sheet, Table,
Badge (chips), Progress, Skeleton, Switch, Form controls, Command (`Ctrl K` palette).

Domain components (custom): AppShell (grid, rail or top tabs, header, status bar), TopNav (Studio's
header tabs), StatusBar (Studio's foot), MarketBar, PageHeader, Panel,
StatBlock, LegsTable (side, quantity, instrument, type, strike, expiry, price, delta, IV),
PayoffChart, GreeksPanel, ErrorNotice (the Error state over the shadcn Alert; field validation
stays a plain inline message), RiskNotice (warning with the breached limit and the "record anyway"
rule), DecisionBar, AnalysisPanel (thesis, counter-thesis, risks, invalidation, confidence,
outlook, inputs cited, prompt version and model), CandleChart (`lightweight-charts`), SignalRow (strategy,
instrument, evaluation time, late flag, proposal summary), StrategyEditor (closed vocabulary
forms), BacktestReport (equity, drawdown, distribution, metrics table, walk-forward windows,
declared limits), PositionsTable, JournalEntry (decision, thesis, horizon, score, and under it the
AI analyses that informed it; an analysis with no decision is its own entry: subject, thesis,
outlook with its horizon date, likelihood, outlook score), ThemePicker and LayoutPicker (radio
cards with a thumbnail of the shell in the option's own tokens or a wireframe of the layout),
GuidedTour (a dim layer with a hairline `--accent` cutout around one element and a Popover step
card: progress, title, one or two short sentences, "Pular tour", "Voltar", "Próximo" or "Concluir"; ADR-0046).

## States

- **Loading**: skeleton blocks in `--surface-2` matching the final layout; never spinners over
  numbers.
- **Empty**: one sentence saying what will appear and one action ("Adicione um ativo à watchlist
  para ver sinais"). No illustrations.
- **Error**: notice with `--danger` icon, plain-language cause, one retry action; numbers already
  on screen stay visible.
- **Stale**: freshness in the market bar ("fechamento de ontem", "cotação com atraso de 5 min");
  a stale mark on a position shows its date next to the value and the fair value alongside
  (ADR-0014).
- **Late signal**: chip `atrasado` in `--warning` with the evaluation time (ADR-0010).
- **Limit breach**: RiskNotice in `--warning` border, the breached limit named with both values;
  decisions stay enabled and the breach is recorded (ADR-0004, ADR-0014).
- **No risk profile**: pricing proceeds with a `sem perfil de risco` chip linking to Configurações.
- **Approximation notes**: every note code from the engine (`european_pricing`,
  `intraday_option_fill_at_fair_value`, `short_window_not_annualized`, ...) renders as a
  `--muted` line under the affected number, never hidden.
- **Screen readers**: a state change that isn't purely visual (searching, no results,
  rate-limited, error) is also announced once through a polite live region (`CommandStatus` in the
  shared Command primitive), never per keystroke.

## Formatting (pt-BR)

- Currency: `R$ 1.234,56`; negative `−R$ 1.234,56` (true minus); credits `+ R$ 340,00`.
- Prices: `38,42`; strikes `40,00`; two decimals for stocks and options, four for rates.
- Percentages: comma decimal, at most two decimals (`2,08%`, `28,4%`); rates `10,65% a.a.`.
- Greeks: delta and gamma to four decimals per unit, aggregated as integers per operation; theta in
  `R$ / sessão`; vega in `R$ / ponto`.
- Dates: `17/10/2026` in tables; `17 de outubro` in prose; times `14:32`; sessions `28 sessões`.
- Tickers and series in `--font-mono` uppercase (`PETR4`, `PETRJ400`).
- Time zone: `America/Sao_Paulo`.
- Vocabulary: `UBIQUITOUS_LANGUAGE.md` is binding for every label; the pt-BR term is the
  glossary's translation, never an invention.

## Design gate

Every UI ticket ships with: `npx impeccable detect` clean, `/impeccable critique` by `ui-critic`
with no blocking findings in the default theme, and the token contrast test green for every
theme (4.5:1 text on `--bg` and `--surface`, 3:1 chart and semantic colors on `--bg`).
`/impeccable audit` belongs to the owner.
