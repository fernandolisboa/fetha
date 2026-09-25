---
status: proposed
date: 2026-09-25
---

# Strategy comparison and the walk-forward view read persisted runs; windows are chosen at creation

## Context

Issue #30 asks for two things on top of #18's persisted backtest runs: rolling-window metrics of
a run next to its whole-period metrics, so instability over time is visible, and a side-by-side
comparison of candidate strategy versions (metrics and equity curves). ADR-0014 Q37 already fixes
what walk-forward means (consecutive windows of `windowSessions` sessions, an operation belongs to
the window where it opened, no optimization, not out-of-sample), and ADR-0013 carries
`BacktestConfig.walkForward` and `BacktestRun.walkForward`. The engine computed the windows, but
the app always passed `walkForward: null`, so no run had them. The issue leaves open the window
length, how many runs a comparison holds, what "equity curve" means across runs, and what an old
run shows. Reading the existing window computation for this issue also surfaced two defects in
it. The implementing agent picked the defaults below on 2026-09-25; they are pending the owner's
review on the PR.

## Decision

1. **Windows are part of the run's config, chosen at creation.** `backtest_runs` gains a nullable
   `walk_forward_window_sessions` column, passed to the engine as
   `BacktestConfig.walkForward`, so it is inside the run's `configDigest` and its checkpoints like
   any other config field. The create form offers 21, 63, 126 and 252 sessions (about a month, a
   quarter, a half-year and a year of B3 sessions); **63 is the default**. The action refuses any
   other length. Every new run computes windows; there is no "off" choice, since the windows cost
   one pass over the run's own arrays at completion.
2. **Old runs keep no windows.** A completed run is immutable (CONTEXT.md "Backtest run"), so a
   run created before this change reports `walkForward: null`, and the report says so and points
   to running a new backtest. Nothing is backfilled: re-simulating an old run would be a new run.
   No persisted `WalkForwardWindow` existed before this change, so the contracts pin (ADR-0013
   addendum on persisted artifacts) needs no migration and no `.optional()` escape.
3. **A window's max drawdown is measured inside the window (sharpens ADR-0013 "Walk-forward").**
   "Computed on that window's slice of the equity curve" now also holds for drawdown: the running
   peak restarts at the window's own starting equity (the previous window's last equity point, or
   the initial capital for the first). The engine previously reused each point's whole-run
   drawdown, so a window that only rose after an earlier crash reported that crash as its own.
4. **A month's income tax belongs to one window (sharpens ADR-0013 "Walk-forward").** Tax is
   monthly (ADR-0013 "Taxes"), while windows are session counts that can cut a month. A
   `MonthlyTax` is attributed to the window holding that month's last session inside the period,
   where the month's gains are complete. The engine previously counted a cut month in both
   windows, so the windows' taxes summed to more than the run's. A property test now checks that
   the windows tile the period and that their sessions, operations, fees, taxes and slippage sum
   to the whole run's.
5. **Annualized metrics stay null in short windows.** `cagr` and `sharpe` follow the run rule
   (null under 126 sessions, `short_window_not_annualized`), so at the default 63 sessions they are
   null in every window. The report's window table shows return, max drawdown, win rate, profit
   factor, exposure, sessions and operations per window, with the whole-period row last, and
   leaves the annualized pair to the whole-run metrics above it.
6. **The comparison reads persisted, completed runs only.** `/estrategias/comparar?run=…` takes
   run ids from the query, keeps the user's own completed runs (anything else is dropped, never an
   error that confirms another user's id exists) and re-simulates nothing. Runs may come from
   versions of one strategy or from different strategies; ADR-0014 Q37 says candidates are
   compared by hand-authoring versions and running each, and nothing about that needs one
   strategy. A picker in the page's 320px column lists every completed run grouped by strategy.
7. **At most three runs.** The comparison series palette (item 8) separates every pair of lines
   under protan, deutan and normal vision at three; a fourth hue fails that check against the
   others on these dark surfaces. A fourth candidate is a second comparison.
8. **Comparison series colors are three new tokens.** `--series-1` `#3987e5` (blue),
   `--series-2` `#d95926` (orange), `--series-3` `#199e70` (aqua), the same in every theme,
   checked all-pairs against the three themes' `--bg` and `--surface` with the dataviz palette
   validator (worst pair CVD ΔE 9.4, normal-vision ΔE 20.9, each ≥ 3:1). They carry run identity
   only; gains and losses keep `--up` and `--down`, and every line also has a legend entry and a
   direct end label, so identity never rests on color alone.
9. **"Equity curve" in a comparison is cumulative return.** Each run's equity is drawn as
   `equity / initialCapital − 1` on one percentage axis over calendar dates, so runs with
   different capital share a scale (never dual axes, DESIGN.md). Runs over different periods are
   still drawn, each over its own dates, and the page warns that their returns are not over the
   same market. The metrics table shows every whole-run metric per run; the window table aligns
   windows by their exact dates and shows each window's return, with a dash where a run has no
   window with those dates.
10. **No engine version bump.** The two fixes change output only for configs with walk-forward
    set, which no persisted run had, so `ENGINE_VERSION` stays and paused runs keep their
    checkpoints.

## Consequences

The run report gains a walk-forward panel, the strategy pages link to the comparison, and a
Playwright spec covers comparing two versions (run by hand against a preview, like the other
specs). Walk-forward adds one pass over the run's operations, fills and taxes per window at
completion, O(windows × operations); it does not touch `runBacktest`'s per-session cost (#58).
Picker labels need each strategy's version numbers, read through the `strategies` entry point
once per strategy with completed runs.
