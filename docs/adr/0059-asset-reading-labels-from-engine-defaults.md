---
status: accepted
date: 2026-10-13
---

# The asset reading: engine labels from project-default thresholds (#304, amends 0013)

## Context

A user opening a ticker (the watchlist, an asset page) needs a quick read before reaching for a
chart or a backtest: is it trending, is it cheap or rich on momentum, is its range calm or wide,
is its implied volatility low or high, are its options even liquid enough to trade. ADR-0009's
first principle still holds: the AI never produces a number, only the engine computes, so this
reading is a deterministic engine artifact, not an AI summary — it has no prose and cites nothing,
it is read off already-ingested daily and intraday-tier-free reference data the same way every
other engine method is.

The engine already has every indicator this needs (`sma`, `rsi`, `atr`, `iv_rank`, ADR-0048/
0049), the IV index (ADR-0054) and the option series/day-price collections (ADR-0056). What it
lacks is a single call that reads all of them for one ticker at one instant and turns the numbers
into a handful of plain-language labels a list view or a page header can show without its own
copy of the thresholds.

## Decision

**One new frozen method, `assetReading(input: AssetReadingInput): Promise<Result<AssetReading>>`**
(ADR-0013's ten methods become eleven). `AssetReadingInput` is `{ view, ticker, at }`: a `view`
narrow enough to hold just one ticker's candles, IV points and option series, like every other
method's `MarketView`.

**`trend`** (`TrendLabel`: `up` | `down` | `sideways`): SMA 50 and SMA 200 of adjusted closes at
the latest visible daily candle. `up` when `close > SMA50 > SMA200`, `down` when the same three
sit in the opposite order, `sideways` otherwise (including every tie). SMA 50/200 is the
conventional long/short trend-following pair (the "golden/death cross" pair of lengths), not this
project's own invention. An SMA is read only when its whole window of sessions holds a candle
(ADR-0050): the same `readingAt` rule `evaluateStrategy` uses, extracted to
`internal/reading-at.ts` so both callers share it rather than drift. Null when either SMA itself
is null (too little history, or a gap wide enough to break ADR-0050's strict window).

**`momentum`** (`MomentumLabel`: `oversold` | `neutral` | `overbought`): Wilder RSI(14), read over
its fixed trailing window (ADR-0048, 6×14 candles) the same way. `oversold` at RSI ≤ 30,
`overbought` at RSI ≥ 70, source: Wilder, _New Concepts in Technical Trading Systems_ (1978), the
indicator's own standard bands — not a project default. Null when the window is short.

**`range`** (`RangeLabel`: `calm` | `normal` | `wide`): Wilder ATR(14), same window rule, same
source. `atrShare = ATR / close` (a ratio, `RATIO_SCALE`). **The 1.5%/3.5% `atrShare` bands are
this project's own default**, not from Wilder or any reference — ATR has no conventional
"calm/wide" band in the literature, only the raw indicator. Expect this band to move once real B3
tickers are read through it.

**`impliedVolatility`** (`ImpliedVolatilityLabel`: `low` | `normal` | `high`): `latest` is the
latest IV index point (ADR-0054) visible at `at`. `ivRank` is `iv_rank` over 252 sessions (one
trading year) at that point, read only when its whole window of sessions holds an IV point
(ADR-0051), on the existing 0–100 scale. **The 30/70 iv-rank bands are this project's own
default** (a common convention in retail options literature, but not sourced to one text the way
RSI/ATR are) and the 252-session lookback is one trading year, not a reference value either. Null
label when `ivRank` is null.

**`options`** (`OptionLiquidityLabel`: `liquid` | `thin` | `none`): the series in `optionSeries`
whose `underlying` is this ticker, visible at `at`, not yet expired at the reading session
(`expiry >= session`; `session` falls back to the calendar session at or before `at` when there is
no candle). Strike-epoch duplicates (ADR-0056) collapse to one row per ticker first.
`tradedSeries` counts the ones with an `OptionDayPrice` row on that session showing `trades > 0`.
`nextExpiries` lists the first three distinct expiries ascending, each with its own listed and
traded count. **The label bar, `tradedSeries >= 10` for `liquid`, otherwise `thin` from one traded
series and `none` at zero, is this project's own default**: B3's options book for most single
names is thin enough that a reference "liquid" bar would misclassify everything the owner
actually trades.

**Every threshold above lives once**, in `assetReadingThresholds` (`packages/engine/src/api.ts`),
and every classifier reads from it — never a repeated literal. Every boundary is inclusive on the
side of the extreme label (an RSI of exactly 30 reads `oversold`, an IV rank of exactly 70 reads
`high`), the opposite side strict, so a tie never lands on two labels.

**Classification is five small pure functions** (`classifyTrend`, `classifyMomentum`,
`classifyRange`, `classifyImpliedVolatility`, `classifyOptionLiquidity` in
`internal/asset-reading.ts`), each property-tested for monotonicity and boundary inclusivity
independently of the candle/IV/option-series plumbing around them.

**No new `NoteCode`.** Nothing this reading computes needs a note the existing vocabulary does not
already cover; "not enough data" is a null label, `ok: true`, the same convention `indicators()`
and `impliedVolatilityIndex()` already use, not an `invalid_input`. `invalid_input` is reserved for
a structurally broken view (a duplicate calendar date, a duplicate candle or IV point, a
non-positive price), exactly where every other method already raises it.

**No `ENGINE_VERSION` bump.** A new method with new types is additive; nothing it returns is
checkpointed or persisted (ADR-0013's change policy ties a version bump to a checkpoint- or
persistence-breaking shape change, not to "the interface grew").

## Considered options

- Let the caller supply its own thresholds. Rejected for now: nothing in the product needs a
  per-user or per-strategy threshold yet, and `assetReadingThresholds` already names every number
  in one place a later ticket can turn into an input without moving the computation.
- Fold this into `indicators()` plus a web-side labeling layer. Rejected: the labels need the
  option series and the IV rank together with the candle indicators in one read, and a
  "why trust this label" answer belongs with the computation (ADR-0009), not scattered across
  `apps/web`.
- Source the ATR-share and IV-rank bands from a published text, deferring the ticket until one is
  found. Rejected: no standard reference gives a volatility-share or IV-rank cut for B3 names
  specifically, and a stated, revisable default is more honest than a borrowed number dressed up as
  one.

## Consequences

Amends ADR-0013: `assetReading`, `AssetReadingInput`, `AssetReading`, `AssetReadingThresholds`,
`assetReadingThresholds`, and the `TrendLabel`/`MomentumLabel`/`RangeLabel`/
`ImpliedVolatilityLabel`/`OptionLiquidityLabel` vocabularies (and their `as const` arrays) join the
frozen interface; the addendum there lists them. `internal/reading-at.ts` is a new shared module
(`readingAt`, extracted unchanged from `evaluate-strategy.ts`); `evaluate-strategy.ts`'s own
behavior and tests are unchanged by the extraction.

## Web

- `market-data`'s `loadAssetReading` builds the view (`buildAssetReadingView`): the last 252
  calendar sessions up to now (the longest window any reading needs: IV rank 252, SMA 200,
  Wilder 6 x 14), the ticker's candles and IV index points over them, its corporate-action
  factors, and the option series still listed at the reading session with that session's day
  prices only. The reading is computed on each request, never stored: nothing new is persisted.
- The watchlist shows chips for trend and IV and an "opções" mark when the options read
  `liquid`. The "no active strategy looks at these assets" notice is one line above the table,
  not per row: the nightly evaluation runs every active daily strategy over the whole watchlist
  (`evaluate-signals.ts`), so the state is the same for every row.
- The asset page shows a "Leitura do ativo" panel (one templated pt-BR sentence per label, no AI)
  and a "Próximos passos" panel: keep following (add to the watchlist when it is not there),
  study an operation in the builder pre-filled through `?ticker=`, and a starter recipe marked
  "em breve" until #306 ships. The copy says a strategy is optional and what an active one adds.
- A three-step contextual tour runs on the first asset page visit (ADR-0046 addendum), and
  `/como-usar` gains "Opções em 10 minutos" with engine payoffs of `long-call`, `long-put` and
  `bull-call-spread` on a fictitious, illustrative chain.
