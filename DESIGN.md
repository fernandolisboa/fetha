# Fetha — Design

Canonical design reference. Visual truth for every screen; `CLAUDE.md` mirrors the token summary
so `/design` and `/design-sync` agree with this file. Mockups: the Fetha Workstation design canvas
(three theme artboards of the structure/payoff screen inside the shell, desktop 1440×900).

## Direction

A dense, data-first workstation for one person deciding about their own money. Dark by default,
numbers first: tabular figures everywhere, monospaced numerals, tight vertical rhythm, hairlines
instead of shadows, one accent for actions and a separate, reserved color for risk. Hierarchy
borrowed from good trading and analytics layouts; nothing copied. Not a fintech landing page.

## Structure (one set of components; themes change tokens, never anatomy)

- **App shell**: a CSS grid with named areas (header, nav, content). Header 48px: wordmark,
  command search (`Ctrl K`: instrument, series or strategy), market bar (IBOV, CDI, the focused
  instrument's last price and change, data freshness: "14:32 · cotação com atraso de 5 min" or
  "fechamento de ontem"), account menu. Nav: a left rail, 200px with icons and labels, 56px
  collapsed with icons only, state remembered per user; six destinations: Watchlist, Sinais (with
  an unread count), Estratégias, Carteira, Diário, Configurações; declared capital at the rail
  foot. Under 1024px the rail collapses; under 768px it becomes a bottom tab bar (rare: desktop
  first).
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
- **Themes** are per-user (`data-theme` on `<html>`, chosen in Configurações), three at launch:
  `instrumento` (default), `terminal`, `amplo`. A theme changes color, type, radius, elevation and
  density; every component keeps its anatomy (ADR-0015).

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

### Type scale (px, Instrumento values)

11 overline (uppercase, 0.06em tracking) · 12 meta · 13 body and panel title · 15 inputs · 18 stat
value (mono) · 22 page headline (display) · 26 hero value (mono, e.g. equity). Overline and meta
are fixed; the other steps scale with the theme's density factor (Terminal 0.95, Amplo 1.06,
rounded to whole px), which is how the three artboards differ. Numbers always
`font-variant-numeric: tabular-nums` in `--font-mono`.

### Spacing and layout

4px base: 4, 6, 8, 10, 12, 14, 16, 20, 24, 32. Page padding 16px 20px. Panel gap 14px. Content
grid `minmax(0,1fr) 320px`; charts fill their panel width and keep a 800×340 aspect for payoff,
equity and drawdown. Hit targets ≥ 32px desktop (Terminal 28px on table row actions), ≥ 44px on
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
Never dual axes, never pie charts.

## Component inventory

shadcn/ui primitives (mandatory, restyled by tokens): Button, Input, Label, Select, Combobox
(instrument and series search), Tabs, Dialog, DropdownMenu, Popover, Tooltip, Toast, Sheet, Table,
Badge (chips), Progress, Skeleton, Switch, Form controls, Command (`Ctrl K` palette).

Domain components (custom): AppShell (grid, rail, header), MarketBar, PageHeader, Panel,
StatBlock, LegsTable (side, quantity, instrument, type, strike, expiry, price, delta, IV),
PayoffChart, GreeksPanel, RiskNotice (warning with the breached limit and the "record anyway"
rule), DecisionBar, AnalysisPanel (thesis, counter-thesis, risks, invalidation, confidence, inputs
cited, prompt version and model), CandleChart (`lightweight-charts`), SignalRow (strategy,
instrument, evaluation time, late flag, proposal summary), StrategyEditor (closed vocabulary
forms), BacktestReport (equity, drawdown, distribution, metrics table, walk-forward windows,
declared limits), PositionsTable, JournalEntry (decision, thesis, horizon, score), ThemePicker.

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
with no blocking findings in the default theme, and the token contrast test green for all three
themes (4.5:1 text on `--bg` and `--surface`, 3:1 chart and semantic colors on `--bg`).
`/impeccable audit` belongs to the owner.
