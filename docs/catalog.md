# Structure catalog coverage

The shared, read-only catalog every user picks a structure from (docs/adr/0012,
docs/adr/0053). Entries live in `apps/web/src/modules/strategies/catalog.json`;
`node apps/web/scripts/seed-structures.mjs` writes them to `structures`, and the strategy editor
starts a new strategy on an entry with its default strikes and expiry window.
`apps/web/src/modules/strategies/catalog.test.ts` parses every entry through the contracts
schemas and fails when an entry is missing from this checklist.

Sources, the only two the catalog uses (#20):

- **Hull**: John C. Hull, _Options, Futures, and Other Derivatives_, 10th (2018) and 11th (2021)
  editions, chapter 12 "Trading Strategies Involving Options". Cited by section title; the
  section numbers were not verified against both editions.
- **B3 Edu**: B3's educational page "Opções" (https://edu.b3.com.br/w/opcoes), which names
  buying calls and puts for directional exposure, bull and bear spreads ("travas de alta e
  baixa") and the covered call ("lançamento coberto").

Defaults are this project's own starting point, not taken from either source: strikes by
moneyness at 0% or ±5% of the spot, rising with the strike rank; an expiry 15 to 45 business
days out for structures that sell premium or spread it, 20 to 60 for structures that buy it or
hedge a stock held (the collar included). A user edits both before saving. A coarse strike grid
can still resolve two ranks onto one strike, which the engine refuses as degenerate.

The short straddle and short strangle have an unbounded loss, which both sizing rules refuse:
they can be priced and saved, but a backtest opens no operation from them until margin-based
sizing exists.

A strike rank that carries both a call and a put (the straddles, strip, strap and box) resolves
to the nearest strike listed for either right, then needs that exact strike listed for the
other. When it is not, the engine skips the entry with `no_series_matches`.

## Covered

| id                 | Name                     | Source                                                                   |
| ------------------ | ------------------------ | ------------------------------------------------------------------------ |
| `stock`            | Compra de ação           | baseline (the underlying alone), no option source applies                |
| `long-call`        | Compra de call           | B3 Edu "Opções"                                                          |
| `long-put`         | Compra de put            | B3 Edu "Opções"                                                          |
| `covered-call`     | Lançamento coberto       | Hull, "Trading an Option and the Underlying Asset"; B3 Edu "Opções"      |
| `protective-put`   | Put de proteção          | Hull, "Trading an Option and the Underlying Asset"                       |
| `collar`           | Collar                   | Hull, "Trading an Option and the Underlying Asset" (both positions held) |
| `bull-call-spread` | Trava de alta com calls  | Hull, "Spreads" (bull spreads); B3 Edu "Opções"                          |
| `bull-put-spread`  | Trava de alta com puts   | Hull, "Spreads" (bull spreads); B3 Edu "Opções"                          |
| `bear-call-spread` | Trava de baixa com calls | Hull, "Spreads" (bear spreads); B3 Edu "Opções"                          |
| `bear-put-spread`  | Trava de baixa com puts  | Hull, "Spreads" (bear spreads); B3 Edu "Opções"                          |
| `box-spread`       | Box de quatro pontas     | Hull, "Spreads" (box spreads)                                            |
| `call-butterfly`   | Borboleta com calls      | Hull, "Spreads" (butterfly spreads)                                      |
| `put-butterfly`    | Borboleta com puts       | Hull, "Spreads" (butterfly spreads)                                      |
| `long-straddle`    | Straddle comprado        | Hull, "Combinations" (straddle)                                          |
| `short-straddle`   | Straddle vendido         | Hull, "Combinations" (top straddle)                                      |
| `strip`            | Strip                    | Hull, "Combinations" (strips and straps)                                 |
| `strap`            | Strap                    | Hull, "Combinations" (strips and straps)                                 |
| `long-strangle`    | Strangle comprado        | Hull, "Combinations" (strangles)                                         |
| `short-strangle`   | Strangle vendido         | Hull, "Combinations" (top vertical combination)                          |

## Left out

| Structure                                              | Why                                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Calendar and diagonal spreads (Hull, "Spreads")        | Two expiries; a structure shares one expiry (ADR-0014).                                                     |
| Principal-protected notes (Hull, chapter 12)           | Needs a zero-coupon bond, which is not a listed instrument here.                                            |
| Reverse covered call and reverse protective put (Hull) | Short the underlying, which needs stock lending (aluguel) the portfolio and the engine do not model.        |
| Naked short call or put                                | No section of the two sources defines it as a strategy; the engine prices it, but B3 margin is not modeled. |
| Condors, iron condor, iron butterfly, ratio spreads    | Not found in the chapter or the B3 page read for this checklist; add them when a citable source is in hand. |
| Long & short (B3 Edu "Opções")                         | Two underlyings; a structure has one.                                                                       |
