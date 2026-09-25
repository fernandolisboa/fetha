import { Decimal } from "decimal.js";
import {
  decimalStringSchema,
  optionRightSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type Instant,
  type RiskProfile,
  type SessionDate,
} from "@fetha/contracts";
import {
  engine,
  type Greeks,
  type LegValuation,
  type MarketView,
  type OperationPricing,
  type OperationValuation,
  type PortfolioValuation,
  type Result,
  type SettlementProposal,
} from "@fetha/engine";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import {
  buildOperationMarketView,
  buildPortfolioMarketView,
  optionSeriesForFills,
  seriesKey,
  tradingSessionForDate,
} from "@/modules/market-data";

import {
  cashCentavos,
  holdingKey,
  holdingsFromFills,
  type Holding,
  type LedgerFill,
} from "./bookkeeping";
import {
  planOperation,
  toEngineOperation,
  type OperationState,
  type SeriesByHolding,
  type SeriesFacts,
} from "./operation-plan";
import { PortfolioRepository, type FillRecord, type OperationRecord } from "./portfolio-repository";
import { RiskProfileRepository } from "./risk-profile-repository";

export interface PositionRow {
  holding: Holding;
  series: SeriesFacts | null;
  valuation: PortfolioValuation["positions"][number] | null;
  fairValue: LegValuation["fairValue"];
}

export interface PendingSettlement {
  operation: OperationRecord;
  state: OperationState;
  fillIds: string[];
  proposal: SettlementProposal | null;
  strikes: Record<string, string>;
}

export interface OperationRow {
  operation: OperationRecord;
  state: OperationState | null;
  valuation: OperationValuation | null;
  pendingSettlement: boolean;
}

export interface ExpiredHolding {
  holding: Holding;
  fillIds: string[];
}

export interface PortfolioReadModel {
  at: Instant;
  riskProfile: RiskProfile | null;
  cash: number;
  valuation: Result<PortfolioValuation> | null;
  greeks: Greeks | null;
  positions: PositionRow[];
  unknownSeries: Holding[];
  expiredHoldings: ExpiredHolding[];
  operations: OperationRow[];
  pendingSettlements: PendingSettlement[];
  fills: FillRecord[];
}

// Facts for every option fill's series, keyed by `holdingKey(ticker,
// expiry)`: the expiry resolved when the fill was written (ADR-0021 item 3).
export async function seriesByHolding(
  db: Database,
  fills: readonly FillRecord[],
): Promise<Map<string, SeriesFacts>> {
  const optionFills = fills.filter((fill) => fill.assetClass === "option" && fill.expiry);
  const resolved = await optionSeriesForFills(db, optionFills);
  const facts = new Map<string, SeriesFacts>();
  for (const fill of optionFills) {
    const series = resolved.get(seriesKey(fill.ticker, fill.session));
    if (!series || series.expiry !== fill.expiry) {
      continue;
    }
    facts.set(holdingKey(fill.ticker, fill.expiry), {
      underlying: tickerSchema.parse(series.underlying),
      right: optionRightSchema.parse(series.right),
      strike: series.strike,
      expiry: sessionDateSchema.parse(series.expiry),
    });
  }
  return facts;
}

async function expiredBy(
  db: Database,
  expiries: readonly SessionDate[],
  at: Instant,
): Promise<Set<SessionDate>> {
  const expired = new Set<SessionDate>();
  const atDate = new Date(at);
  await Promise.all(
    [...new Set(expiries)].map(async (expiry) => {
      const session = await tradingSessionForDate(db, expiry);
      if (session ? new Date(session.close) <= atDate : expiry < at.slice(0, 10)) {
        expired.add(expiry);
      }
    }),
  );
  return expired;
}

// The open operations `maxOpenOperations` counts, the same set the dashboard
// marks: one whose expiry session has closed is pending settlement, not open
// risk (ADR-0021 item 5).
export async function countLiveOpenOperations(
  db: Database,
  user: ScopedUser,
  at: Instant,
): Promise<number> {
  const open = (await new PortfolioRepository(db, user).listOperations()).filter(
    (operation) => operation.status === "open",
  );
  const expired = await expiredBy(
    db,
    open.flatMap((operation) => (operation.expiry ? [operation.expiry] : [])),
    at,
  );
  return open.filter((operation) => !operation.expiry || !expired.has(operation.expiry)).length;
}

export async function hasExpired(db: Database, expiry: SessionDate, at: Instant): Promise<boolean> {
  return (await expiredBy(db, [expiry], at)).has(expiry);
}

function stateOf(fills: readonly LedgerFill[], series: SeriesByHolding): OperationState | null {
  const plan = planOperation(fills, series);
  return plan.ok ? plan.state : null;
}

// The view is built at the expiry session's close, the instant the engine
// settles at, so the reused ticker resolves to the cycle that expired.
export async function proposeSettlementFor(
  db: Database,
  id: string,
  state: OperationState,
  expiry: SessionDate,
): Promise<SettlementProposal | null> {
  const session = await tradingSessionForDate(db, expiry);
  if (!session) {
    return null;
  }
  const view = await buildOperationMarketView(db, state.underlying, session.close);
  const proposal = await engine.proposeSettlement({
    view,
    operation: toEngineOperation(id, state),
  });
  return proposal.ok ? proposal.value : null;
}

async function priceOneLeg(
  view: MarketView,
  at: Instant,
  holding: Holding,
  series: SeriesByHolding,
): Promise<Result<OperationPricing> | null> {
  const facts = series.get(holdingKey(holding.ticker, holding.expiry));
  if (holding.assetClass !== "option" || !facts) {
    return null;
  }
  const quantity = holding.position.quantity;
  return engine.priceOperation({
    view,
    at,
    legs: [
      {
        role: facts.right,
        side: quantity > 0 ? "buy" : "sell",
        ticker: holding.ticker,
        quantity: quantitySchema.parse(Math.abs(quantity)),
      },
    ],
  });
}

// `markToMarket` leaves option positions out of its greeks (ADR-0013 #26 addendum); an option
// held outside any operation is added here from its own one-leg pricing, so the totals cover
// every open option exactly once.
function addGreeks(all: readonly Greeks[]): Greeks {
  const sum = (key: keyof Greeks) =>
    decimalStringSchema.parse(
      all.reduce((acc, greeks) => acc.add(greeks[key]), new Decimal(0)).toFixed(6),
    );
  return {
    delta: sum("delta"),
    gamma: sum("gamma"),
    theta: sum("theta"),
    vega: sum("vega"),
    rho: sum("rho"),
  };
}

// Everything the portfolio page reads, valued by the engine at `at`
// (ADR-0021 items 3, 5 and 6).
export async function loadPortfolio(
  db: Database,
  user: ScopedUser,
  at: Instant,
): Promise<PortfolioReadModel> {
  const repository = new PortfolioRepository(db, user);
  const [fills, operations, riskProfile] = await Promise.all([
    repository.listFills(),
    repository.listOperations(),
    new RiskProfileRepository(db, user).current(),
  ]);
  const series = await seriesByHolding(db, fills);
  const expired = await expiredBy(
    db,
    [
      ...fills.flatMap((fill) => (fill.expiry ? [fill.expiry] : [])),
      ...operations.flatMap((operation) => (operation.expiry ? [operation.expiry] : [])),
    ],
    at,
  );

  const isExpiredSeries = (holding: Holding) =>
    holding.assetClass === "option" &&
    holding.expiry !== null &&
    series.has(holdingKey(holding.ticker, holding.expiry)) &&
    expired.has(holding.expiry);

  const liveHoldings: Holding[] = [];
  const unknownSeries: Holding[] = [];
  for (const holding of holdingsFromFills(fills)) {
    if (holding.assetClass === "stock") {
      liveHoldings.push(holding);
    } else if (!holding.expiry || !series.has(holdingKey(holding.ticker, holding.expiry))) {
      unknownSeries.push(holding);
    } else if (!isExpiredSeries(holding)) {
      liveHoldings.push(holding);
    }
  }

  // An expired series still held outside any operation: grouping these fills is the way to
  // its settlement (ADR-0021 item 6). One held inside an operation shows as that
  // operation's pending settlement instead.
  const unassigned = fills.filter((fill) => fill.operationId === null);
  const expiredHoldings: ExpiredHolding[] = holdingsFromFills(unassigned)
    .filter(isExpiredSeries)
    .map((holding) => ({
      holding,
      fillIds: unassigned
        .filter((fill) => fill.ticker === holding.ticker && fill.expiry === holding.expiry)
        .map((fill) => fill.id),
    }));

  const liveOperations: { record: OperationRecord; state: OperationState }[] = [];
  const pendingSettlements: PendingSettlement[] = [];
  const stateById = new Map<string, OperationState | null>();
  for (const operation of operations) {
    const operationFills = fills.filter((fill) => fill.operationId === operation.id);
    const state = operation.status === "open" ? stateOf(operationFills, series) : null;
    stateById.set(operation.id, state);
    if (!state) {
      continue;
    }
    const openOption = state.legs.some((leg) => leg.role !== "stock");
    if (openOption && state.expiry && expired.has(state.expiry)) {
      pendingSettlements.push({
        operation,
        state,
        fillIds: operationFills.map((fill) => fill.id),
        proposal: await proposeSettlementFor(db, operation.id, state, state.expiry),
        strikes: Object.fromEntries(
          state.legs.flatMap((leg) => {
            const facts = state.expiry
              ? series.get(holdingKey(leg.ticker, state.expiry))
              : undefined;
            return facts ? [[leg.ticker, facts.strike]] : [];
          }),
        ),
      });
    } else {
      liveOperations.push({ record: operation, state });
    }
  }

  const cash = cashCentavos(riskProfile?.declaredCapital ?? 0, fills);
  const underlyings = [
    ...liveHoldings.map((holding) =>
      holding.assetClass === "stock"
        ? holding.ticker
        : (series.get(holdingKey(holding.ticker, holding.expiry))?.underlying ?? holding.ticker),
    ),
    ...liveOperations.map(({ state }) => state.underlying),
  ];

  let valuation: Result<PortfolioValuation> | null = null;
  let greeks: Greeks | null = null;
  const fairValues = new Map<string, LegValuation["fairValue"]>();
  if (underlyings.length > 0) {
    const view = await buildPortfolioMarketView(db, underlyings, at);
    valuation = await engine.markToMarket({
      view,
      at,
      positions: liveHoldings.map((holding) => holding.position),
      operations: liveOperations.map(({ record, state }) => toEngineOperation(record.id, state)),
      cash,
      ...(riskProfile ? { riskProfile } : {}),
    });
    const standalone = holdingsFromFills(unassigned).filter(
      (holding) => holding.assetClass === "option" && !isExpiredSeries(holding),
    );
    const [, standaloneGreeks] = await Promise.all([
      Promise.all(
        liveHoldings.map(async (holding) => {
          const pricing = await priceOneLeg(view, at, holding, series);
          if (pricing?.ok) {
            fairValues.set(holding.ticker, pricing.value.legs[0]?.fairValue ?? null);
          }
        }),
      ),
      Promise.all(standalone.map((holding) => priceOneLeg(view, at, holding, series))),
    ]);
    if (valuation.ok) {
      greeks = addGreeks([
        valuation.value.totals.greeks,
        ...standaloneGreeks.flatMap((pricing) => (pricing?.ok ? [pricing.value.greeks] : [])),
      ]);
    }
  }

  const valued = valuation?.ok ? valuation.value : null;
  return {
    at,
    riskProfile,
    cash,
    valuation,
    greeks,
    positions: liveHoldings.map((holding) => ({
      holding,
      series: holding.expiry
        ? (series.get(holdingKey(holding.ticker, holding.expiry)) ?? null)
        : null,
      valuation:
        valued?.positions.find((entry) => entry.position.ticker === holding.ticker) ?? null,
      fairValue: fairValues.get(holding.ticker) ?? null,
    })),
    unknownSeries,
    expiredHoldings,
    operations: operations.map((operation) => ({
      operation,
      state: stateById.get(operation.id) ?? null,
      valuation: valued?.operations.find((entry) => entry.operation.id === operation.id) ?? null,
      pendingSettlement: pendingSettlements.some(
        (pending) => pending.operation.id === operation.id,
      ),
    })),
    pendingSettlements,
    fills,
  };
}
