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
   engine.
   - _Average cost_ is the moving average of the fills that opened the net position (B3's "custo
     médio"): a fill in the direction of the position re-averages it, a fill against it reduces
     the quantity at the same average, and a fill that crosses zero opens the opposite position
     at that fill's price. Costs are not folded into the average; they are charged to cash.
   - _Option positions are keyed by series, not ticker_: `(ticker, expiry)`. B3 reuses option
     tickers across listing cycles (ADR-0017), so a ticker alone would net an expired cycle
     against the next one. An option fill's expiry is resolved when the fill is written, as the
     earliest listed expiry for that ticker on or after the fill's session.
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
   stock with a daily candle), which also decides its asset class. Only an unassigned fill can be
   deleted.

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

## Considered options

- Storing positions as rows updated by each fill: two sources of truth that can drift, and a
  re-import or a deleted fill would need a replay anyway.
- Folding costs into average cost: matches the tax basis, but the engine's `Position.averageCost`
  is "the average price of the fills" (ADR-0013); costs stay visible in cash instead.
- A spreadsheet library (SheetJS, exceljs, read-excel-file): SheetJS's npm build is unmaintained
  with known advisories, the others add a dependency tree for one worksheet of plain cells.
