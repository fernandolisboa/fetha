---
status: proposed
date: 2026-09-25
---

# Real portfolio: fills are the only stored fact; positions, cash and operation legs are derived

## Context

Issue #26 builds the real portfolio (CONTEXT.md flow 6): fills entered by hand or imported from
the B3 investor-area spreadsheet, positions, operations grouped by the user, a mark-to-market
dashboard and the settlement proposal flow. The engine side already exists: `markToMarket` and
`proposeSettlement` were implemented by #25 (ADR-0013 #25 addendum) and take `Position[]`,
`Operation[]` and `cash` as inputs. The issue leaves several forks open. The implementing agent
picked the defaults below on 2026-09-25; they are pending the owner's review on the PR.

## Decision

1. **Scope.** #26 delivers its own acceptance criteria. A held operation as a decision origin in
   the journal, and scoring with `realizedFills` from the portfolio (ADR-0014 Q54 "Inputs until
   the portfolio exists"), are a follow-up issue: they change the `decisions` origin vocabulary
   and the scoring job, a separate review surface. The builder's `openOperationCount` now counts
   the user's open operations (it was always 0 before #26).
2. **Two tables.** `fills` (one row per fill: ticker, asset class, side, quantity, price,
   session, costs in centavos, source `manual | b3_import | settlement`, the resolved expiry of an
   option fill, the operation it belongs to, an import key) and `operations` (underlying, status
   `open | closed | expired`, shared expiry, opened and closed sessions). Positions are never
   stored: they are derived from fills on read, so a fill is the only fact and nothing can drift.
3. **Bookkeeping lives at the portfolio edge.** The frozen engine interface (ADR-0013) takes
   positions, operation legs and cash as inputs, so deriving them is the caller's job:
   `modules/portfolio/bookkeeping.ts`, pure functions with property tests, no I/O. Everything
   valued (prices, fair value, greeks, P&L, limits, settlement outcomes) still comes from the
   engine. This qualifies ADR-0006 ("`packages/engine` contains every computation Fetha
   shows"): ledger arithmetic over the user's own fills (net quantity, average cost, cash) sits
   at the portfolio edge; every valuation stays in the engine.
   - _Average cost_ is the moving average of the fills that opened the net position (B3's "custo
     médio"): a fill in the direction of the position re-averages it, a fill against it reduces
     the quantity at the same average, and a fill that crosses zero opens the opposite position
     at that fill's price. Costs are not folded into the average; they are charged to cash.
   - _Option positions are keyed by series, not ticker_: `(ticker, expiry)`. B3 reuses option
     tickers across listing cycles (ADR-0017), so a ticker alone would net an expired cycle
     against the next one. An option fill's expiry is resolved when the fill is written, as the
     earliest expiry for that ticker on or after the fill's session among cycles already listed
     by then (first seen in the registry, or first traded, on or before the session); a fill
     that resolves to nothing keeps no expiry and shows as an unknown series, and a later import
     fills the expiry in once the reference data has the series.
   - _Cash_ is the declared capital of the current risk profile (zero without one) plus every
     fill's cash flow: sells add, buys subtract, costs subtract; each fill's `price × quantity`
     is rounded to centavos half-up, the engine's own rounding. Declared capital is read as the
     portfolio's starting cash; Fetha never reads a balance from a broker (ADR-0003).
4. **Operations are grouped by the user from fills.** A fill belongs to at most one operation.
   An operation has one underlying and one shared expiry (ADR-0014 Q43): its stock fills are in
   the underlying and every option fill's series must be known to the reference data. Its legs
   are the per-ticker net of its own fills, with the average cost as entry price, derived the same
   way positions are. It is `open` while any leg is non-zero, becomes `closed` when every leg nets
   to zero, and becomes `expired` only through a confirmed settlement. An open operation can be
   ungrouped (its fills go back to unassigned); a closed or expired one cannot. Adjusted and
   rolled lifecycles stay out of v1.
5. **Mark to market.** The dashboard calls `markToMarket` at the current instant with the current
   risk profile, the open operations, and the positions whose series has not expired. An option
   position whose expiry session has closed is not passed in (the engine would resolve its reused
   ticker to the next cycle); it is listed as pending settlement instead, and so is an open
   operation whose expiry session has closed, which is left out of `markToMarket` for the same
   reason. Fair value next to a
   stale option mark (Q42, DESIGN.md "Stale") comes from a one-leg `priceOperation` at the same
   instant, since `PositionValuation` carries none.
6. **Settlement.** Every open operation whose expiry session has closed gets a
   `proposeSettlement` proposal. The user confirms it or edits it: each option leg's outcome
   (exercised or assigned, or expired worthless) and the implied stock fill's price and costs.
   Confirming writes, in one transaction, a closing fill at zero price for every open option leg,
   the stock fills of the confirmed outcomes (source `settlement`, dated the expiry session, in
   the operation), and moves the operation to `expired`. An expired option position that belongs
   to no operation is grouped into a one-series operation first; nothing settles on its own.
7. **B3 import.** The source is the "Negociação" export of B3's investor area, `.xlsx`, with the
   columns `Data do Negócio`, `Tipo de Movimentação`, `Mercado`, `Prazo/Vencimento`,
   `Instituição`, `Código de Negociação`, `Quantidade`, `Preço`, `Valor`, found by header name.
   `Prazo/Vencimento` and `Valor` are not read: an option's expiry comes from the reference data
   (item 3) and the amount is quantity times price.
   - _Markets._ "Mercado à Vista" and "Mercado Fracionário" are stock fills (a fractional ticker's
     trailing `F` is dropped); "Opção de Compra" and "Opção de Venda" are option fills. Exercise
     rows are skipped and counted: the settlement flow is the one source of exercise fills, so
     importing them too would double them. Any other market (termo, futuros) is skipped and
     counted.
   - _Idempotency._ Each row gets an import key: a SHA-256 of its normalized date, side, market,
     ticker, quantity, price and institution plus its occurrence index among identical rows of the
     same file, so two genuine identical trades on one day stay two fills and re-importing the
     same or an overlapping export inserts nothing twice. The key is unique per user.
   - _Costs._ The export has no fees, so imported fills carry zero costs; fees arrive with the
     brokerage-note import later (PRODUCT.md). Manual entry takes costs.
   - _Reading._ A minimal OOXML reader over `fflate` (already a dependency), no new package: only
     the first worksheet and the shared strings are inflated, the upload is capped at 1 MB and
     the inflated entries at 10 MB.
   - _Fixture._ The recorded fixture reproduces the documented column layout with synthetic
     trades; it is replaced by an anonymized real export once the owner provides one.
8. **Manual entry** accepts only a ticker the reference data knows (a listed option series, or a
   stock with a daily candle), which also decides its asset class, on a trading session that has
   already opened. Only an unassigned fill can be deleted. Import is limited to 10 per minute and
   the other portfolio writes to 60 per minute per account; the reader refuses a sheet past
   20,000 rows, 256 columns or 500,000 cells, and scans the XML in linear time.
9. **Portfolio greeks.** `markToMarket` leaves option positions out of its greeks, so the
   dashboard adds each option held outside any operation from its own one-leg `priceOperation`;
   every open option counts once. `maxOpenOperations` counts the same operations the dashboard
   marks: an open operation whose expiry session has closed is pending settlement, not open
   risk.

## Consequences

- The engine's `markToMarket` priced every `Position` as a stock, so a standalone option position
  (one not grouped into an operation) came back unpriced. It now prices a position as an option
  when its ticker resolves to a listed series in the view, and leaves option positions out of
  `positionsDelta` (their greeks are not in `PositionValuation`, so the portfolio delta stays the
  stock delta plus the operations' own). The interface is unchanged; ADR-0013's #26 addendum
  records it.

- `portfolio` owns `fills` and `operations`, both user-scoped with isolation tests; a fill's
  operation is a composite foreign key on `(operation_id, user_id)`, so a fill can never point at
  another user's operation even if a caller passed a foreign id.
- `market-data` gains two read entry points: resolving option series for fills, and a market view
  over several underlyings for the portfolio.
- The glossary's "Fills import" names the export; "Position" says an option position is per
  series.

## Known limitations

- Amended by #271: corporate actions are now applied to real positions (see below); the bullet
  this replaces ("corporate actions are not applied to fills ... the user records the adjustment
  by hand") is stale now that factors are ingested (#50/ADR-0052) and the engine rebases an
  operation's legs by them (#69/ADR-0014 Q51).
- A corporate-action factor that does not evenly divide a fill's own quantity (e.g. a bonus or
  grouping that does not land on a whole share for that particular fill) is refused rather than
  rounded: every fill of the affected operation or holding is kept exactly as recorded, flagged
  (`OperationState.corporateActionNormalizationSkipped`), and shows its pre-event quantity until
  the user reconciles it by hand. This is intentionally conservative; see "Amended by #271" below.
- An exercised or assigned option closes at zero and its premium stays in cash; it is not carried
  into the stock fill's cost, so the stock's average cost is the strike, not the tax basis. Cash
  and equity are right; a decision's score counts the premium as realized P&L (ADR-0022).
- The Negociação export has no time of day, so fills of one session are applied in the export's
  row order (then entry order); a same-day round trip can leave a different average cost than
  the broker's.

## Amended by #271: corporate actions and real positions

### Context

#69 taught the engine to rebase every leg of an `Operation` by the underlying's split/reverse-split
factors visible between the operation's own `openedAt` and the mark session (`leg.quantity / F`,
`leg.entryPrice × F`, ADR-0014 Q51), and an option leg's strike follows the same factor
(`resolveOptionStrike`). Two gaps remained for real, hand-entered or B3-imported positions:

1. `proposeSettlement`'s exercise/assignment fill kept the nominal `leg.quantity` while its price
   was already the split-adjusted strike — a pre-split position read "buy 100 at R$13.60" where
   B3 delivers 200. The backtester and `score` already rebased the quantity themselves (floor to
   whole shares, cash-settle the residue); only the public settlement proposal was inconsistent.
2. A user who entered a position exactly as their broker shows it today (already on the
   post-split basis) would be rebased a second time by the engine's own forward rebase from
   `openedAt`.

### Decision

**Each fill is recorded as the broker showed it on its own date.** The app never asks the user to
hand-adjust a position for a corporate action.

1. **Fill normalization (portfolio edge, `corporate-action-basis.ts`).** Before fills are netted
   into legs or a flat holding, every fill is converted onto one shared basis — the group's own
   `openedAt` (an operation's shared `openedAt`; a bare holding's own earliest fill session, ADR
   item 5) — by the _inverse_ of the engine's own factor: a fill dated after an ex-date later than
   `openedAt` has its quantity multiplied and its price divided by the product of every factor in
   `(openedAt, fill.session]`. The engine's own forward rebase from `openedAt` then reproduces the
   real, current quantity the broker shows, regardless of how many fills straddle how many splits.
   A fill dated at or before every relevant ex-date, or a position opened on or after one (its own
   `openedAt` already post-split), needs no conversion — the window is empty by construction, so a
   hand-entered post-split position is never rebased twice.
2. **Non-integer rebase is refused, not rounded.** `Quantity` is a positive integer (`packages/
contracts`); a factor that does not evenly divide a particular fill's quantity (an odd lot
   caught by a non-integer ratio such as a 3-for-2 bonus) would otherwise manufacture a phantom
   fractional share. Normalization refuses instead: every fill of the affected operation or
   holding is returned exactly as recorded, and `OperationState.corporateActionNormalizationSkipped`
   is set so a caller can surface it. This is the conservative option named in "Considered
   options" below; a future ticket may instead let the user confirm a hand override for this one
   remaining case.
3. **Bare positions normalize forward to today, not backward to their own earliest fill.** A stock
   or option holding never grouped into an operation (ADR item 5's `Position[]`) has no operation
   for the engine to forward-rebase at mark time — `markToMarket` takes `Position.quantity` and
   `averageCost` as given, with no corporate-action awareness of its own, unlike an `Operation`'s
   legs (which the engine itself rebases forward from `openedAt` on every read). Rebasing a bare
   holding's fills backward to their own earliest session, the way an operation's fills are
   rebased backward to its `openedAt`, would therefore leave the holding on a stale, pre-split
   basis forever — fabricating a loss (review round 1 caught this with a concrete case: 100 @ 30
   pre-split plus 100 @ 15 post-split under a 2-for-1 split must read 300 shares at an average of
   15, the real position today, not 150 @ 30). `normalizeFillsForHoldingsBasis` instead rebases
   each `(ticker, expiry)` group's fills forward, straight to the mark date: quantity ÷ factor,
   price × factor, factor over `(fill.session, asOf]` — the per-fill formula is identical to an
   operation's own backward rebase, only the direction and the shared point (a target instead of
   an origin) differ. Average cost is computed from the same normalized fills.
4. **`proposeSettlement`'s exercise/assignment fill is rebased the same way the backtester already
   does.** The floor-to-whole-shares-and-cash-settle-the-residue logic the backtester's own expiry
   handling used inline is now the shared `rebaseExerciseFillUnits` (`packages/engine/src/
internal/propose-settlement.ts`), used by both `proposeSettlement` and `runBacktest`. See
   ADR-0013's `LegSettlement.residualValue` addendum for the field's semantics and the
   `ENGINE_VERSION` bump it required.
5. **The confirmed settlement's fills are sized at the engine's own rebased quantity.**
   `settlement-plan.ts`'s `planSettlement` now reads the real delivery quantity from
   `LegSettlement.fills[0].quantity` (the engine's already-rebased count) for both the stock
   delivery and the option-closing fill (review round 1: the closing fill at the nominal
   `leg.quantity` was itself a latent bug — every stored fill is read back on the assumption that
   it is "recorded as the broker showed it on its own date" [item 1], so a closing fill written at
   the nominal count rather than the broker-basis count at expiry would be inverse-rebased a
   second time the next time normalization reads it back, whenever a split fell between
   `openedAt` and expiry). A leg with no fill (expired worthless, or dissolved below one effective
   unit) closes at its own broker-basis quantity instead (review round 2: `leg.quantity ÷ F` over
   `(openedAt, expiry]`), with the nominal `leg.quantity` as a fallback only once that rebase
   itself dissolves the leg below one effective unit.
6. **Every path that nets fills into legs shares one basis.** `groupFillsAction` (forming a new
   operation, or adding fills to one) now resolves corporate-action factors the same way
   `confirmSettlementAction`, `loadPortfolio` and the held-operation planner already do, via the
   one shared `corporateActionsByUnderlying` (`portfolio-service.ts`); `planOperation` takes the
   whole map (keyed by underlying) rather than one caller-resolved array, since a new grouping
   does not know its operation's underlying until `planOperation` itself resolves it.
7. **Scoring a held operation is normalized too.** `realized-operation.ts`'s `realizedOperation`
   now takes `corporateActions` and routes every fill — held and later — through
   `normalizeFillsForOperationBasis` before netting, the same seam every other path uses; a
   rebase it refuses is a new `RealizedOperationRefusal`, `corporate_action_normalization_skipped`,
   never a silently wrong score. Closes the gap this ADR previously disclosed as a known
   follow-up.

### Review round 1

Four more findings, fixed in the same change: bare holdings were de-rebasing backward instead of
normalizing forward (item 3, the `30`/`15` example above); `groupFillsAction` was the one path that
planned an operation without its corporate-action factors (item 6); the confirmed settlement's
option-closing fill and the settlement dialog's default price and shown quantity were still reading
the nominal leg instead of the engine's own rebased fill (item 5, and `settlement-dialog.tsx`'s
`SettlementLegView.price`/`quantity`, now sourced from `settlement.fills[0]`); and a non-positive or
out-of-bounds factor in `corporate-action-basis.ts` was previously treated the same as "no rebase
needed" for that one fill instead of refusing its whole group (now guarded by `quantitySchema` and
a `BasisFactorResult` check in both normalization directions). `confirmSettlementAction` also now
checks the delivered quantity the user's dialog showed against what it recomputes server-side,
refusing a mismatch (a factor ingested between render and confirm) rather than settling against
stale figures.

### Review round 2

Three more findings, fixed in the same change. The backward and forward rebases in
`corporate-action-basis.ts` were one function that inverted the factor (`1 ÷ F`) before dividing;
`decimal.js` division is only exact when it terminates, so a factor like 7, 3, 6 or 9 landed one
unit of precision off (`700.00000000000000001`, not `700`) and wrongly refused an exact rebase.
Split into two direction-explicit functions, each one exact multiplication and one exact division
on the factor itself, never its inverse. `realized-operation.ts`'s later-fills branch was
rebasing a realized fill's price as well as its quantity before handing it to the engine's own
`score`; the engine's `computeOperationPnl` already rebases the fill's entry side itself
(`fill.price − entryPrice×F`) against the fill's own recorded, live-session price, so rebasing the
price a second time here scored a result `F` times too large. Only the quantity is normalized to
nominal now; the recorded price passes through unchanged. And item 5's fallback above is narrower
than it reads: an expired-worthless or dissolved leg's closing fill is now sized on the broker
basis too (`leg.quantity ÷ F` over `(openedAt, expiry]`, the same window an option leg's own
rebase caps at), with the nominal `leg.quantity` as a fallback only once that rebase itself
dissolves the leg below one effective unit (#282 below replaces the `dissolvedTickers` list that
first named those legs).

Two notes, not code changes: a stale installed PWA sending `confirmSettlementAction` the
pre-item-8 payload (no delivered `quantity` per choice) fails `settlementInputSchema`'s parse and
gets back `invalid_input`, the same as any other malformed submission — never a silent settle
against a quantity the server never checked. And `corporateActionsByUnderlying` (`portfolio-
service.ts`) reads every factor ever ingested for a ticker with no `asOf` filter of its own, unlike
the engine's own `view.corporateActions`, which the engine itself filters to
`isAtOrBefore(f.asOf, at)` once handed a `MarketView`. This module never marks a point in the
past with it — `groupFillsAction`, `confirmSettlementAction` and `loadPortfolio` all net and
rebase fills against "every corporate action known right now," the real-time view ADR-0021 scopes
this whole feature to (item 2: no broker connection, no historical replay) — so every factor in the
table is already visible by the time any of these reads it; `asOf` only records when B3 disclosed
the factor, not a window to filter by. A future backtest-style "portfolio as of a past date" would
need the same `isAtOrBefore(f.asOf, at)` filter the engine already applies; this module does not
do that today.

### Known follow-up

- A leg whose factor dissolves it below one effective unit (`LegSettlement.fills` empty,
  `residualValue` non-zero) has no confirmed-settlement fill to carry its residual cash into yet;
  `planSettlement` drops the stock delivery for that leg entirely rather than fabricate one. A
  dedicated cash-adjustment fill is a follow-up once a real case surfaces (B3 factors that do not
  evenly divide a share count are uncommon).

### Addendum: stale marks across a split (#279)

`markToMarket` rescales a leg's carried-forward price (one whose session predates a factor inside
the leg's own rebase window) by the factors since that session before computing
`unrealizedPnl`, so an operation held across a split is no longer marked off by the factor when
the underlying or the series did not trade on the ex-date. The mechanism is in the ADR-0013 #279
addendum (`ENGINE_VERSION` 0.13.0); the operation's notes carry
`stale_price_across_corporate_action` when it applies.

### Addendum: one closing count per option leg (#282)

`closingQuantities` (`settlement-plan.ts`) computes the count each option leg closes at: the
engine's delivered fill when there is one, otherwise `leg.quantity ÷ F` over `(openedAt, expiry]`,
otherwise (dissolved below one unit) the nominal count. The settlement dialog shows it,
`confirmSettlementAction` compares the submitted quantity against it (so a factor ingested between
render and confirm returns `conflict` for an expired-worthless leg too), and `planSettlement`
writes it. A non-positive factor or one that pushes the count outside `Quantity`'s bounds is
refused as corrupt data instead of being folded into the dissolved fallback or failing at the
integer column: the dashboard names the corporate-action factor as the reason there is nothing to
confirm (its own message, not the missing-expiry-data one), and confirm returns `no_proposal`.
A leg dissolved below one unit still writes its nominal count, which read-back normalization
inverse-rebases (nominal 1 at F = 10 reads back as 10 against a 1-share buy); that netting gap
belongs with the residual-cash follow-up above. `dissolvedTickers`, which nothing read, is gone.

## Considered options

- Storing positions as rows updated by each fill: two sources of truth that can drift, and a
  re-import or a deleted fill would need a replay anyway.
- Folding costs into average cost: matches the tax basis, but the engine's `Position.averageCost`
  is "the average price of the fills" (ADR-0013); costs stay visible in cash instead.
- A spreadsheet library (SheetJS, exceljs, read-excel-file): SheetJS's npm build is unmaintained
  with known advisories, the others add a dependency tree for one worksheet of plain cells.
