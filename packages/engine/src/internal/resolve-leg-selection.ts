import Decimal from "decimal.js";
import type {
  DecimalString,
  ExpirySelection,
  Instant,
  SessionDate,
  StrikeSelection,
  Structure,
  Ticker,
} from "@fetha/contracts";
import type { EngineError, MarketView, OptionSeries, TradingSession } from "../api";
import { parseDecimal } from "./decimal";
import { compareInstants, isAtOrBefore } from "./instant";
import { assertDefined, invariant } from "./invariant";
import { priceOptionLeg } from "./option-pricing";
import { resolveLegMarketPrice } from "./resolve-market-price";
import { toQuantity } from "./scalars";
import { resolveTimeToExpiryYears } from "./time-to-expiry";

export type ResolvedStructureLeg =
  | { templateIndex: number; role: "stock" }
  | { templateIndex: number; role: "call" | "put"; series: OptionSeries };

export type SelectionResolution =
  | { ok: true; legs: ResolvedStructureLeg[]; expiry: SessionDate }
  | { ok: false; error: EngineError };

export type ResolveLegSelectionInput = {
  structure: Structure;
  underlying: Ticker;
  strikes: readonly StrikeSelection[];
  expiry: ExpirySelection;
  view: MarketView;
  at: Instant;
  spot: DecimalString;
  riskFreeRate: DecimalString;
  dividendYield: DecimalString;
};

function sortedCalendar(calendar: readonly TradingSession[]): TradingSession[] {
  return [...calendar].sort((a, b) => compareInstants(a.open, b.open));
}

function sessionAtOrBefore(
  calendar: readonly TradingSession[],
  at: Instant,
): TradingSession | null {
  let found: TradingSession | null = null;
  for (const session of calendar) {
    if (isAtOrBefore(session.open, at)) found = session;
  }
  return found;
}

function distinctRanks(structure: Structure): number[] {
  const ranks = new Set<number>();
  for (const leg of structure.legs) {
    if (leg.role !== "stock") ranks.add(leg.strikeRank);
  }
  return [...ranks].sort((a, b) => a - b);
}

// Order-invariance (I3): candidates come from filtering MarketView.optionSeries, whose
// row order is not meaningful, so a tie on distance must resolve to the same series
// regardless of array order: the lower strike, then the lexicographically earlier ticker.
function isEarlierByStrikeThenTicker(a: OptionSeries, b: OptionSeries): boolean {
  const strikeCompare = parseDecimal(a.strike).cmp(parseDecimal(b.strike));
  if (strikeCompare !== 0) return strikeCompare < 0;
  return a.ticker < b.ticker;
}

function nearestSeriesByStrike(
  candidates: readonly OptionSeries[],
  target: Decimal,
): OptionSeries | null {
  let best: OptionSeries | null = null;
  let bestDistance: Decimal | null = null;
  for (const series of candidates) {
    const distance = parseDecimal(series.strike).sub(target).abs();
    const isBetter =
      bestDistance === null ||
      distance.lt(bestDistance) ||
      (distance.eq(bestDistance) && best !== null && isEarlierByStrikeThenTicker(series, best));
    if (isBetter) {
      best = series;
      bestDistance = distance;
    }
  }
  return best;
}

function nearestSeriesByAbsDelta(
  candidates: readonly OptionSeries[],
  target: Decimal,
  view: MarketView,
  at: Instant,
  spot: DecimalString,
  riskFreeRate: DecimalString,
  dividendYield: DecimalString,
  timeToExpiryYears: number,
): OptionSeries | null {
  let best: OptionSeries | null = null;
  let bestDistance: Decimal | null = null;
  for (const series of candidates) {
    const marketPrice = resolveLegMarketPrice(view, series.ticker, at);
    if (!marketPrice) continue;
    const valuation = priceOptionLeg({
      leg: { role: series.right, side: "buy", ticker: series.ticker, quantity: toQuantity(1) },
      strike: series.strike,
      spot,
      riskFreeRate,
      dividendYield,
      timeToExpiryYears,
      marketPrice,
      givenVolatility: null,
    });
    if (!valuation.greeks) continue;
    const distance = new Decimal(valuation.greeks.delta).abs().sub(target).abs();
    const isBetter =
      bestDistance === null ||
      distance.lt(bestDistance) ||
      (distance.eq(bestDistance) && best !== null && isEarlierByStrikeThenTicker(series, best));
    if (isBetter) {
      best = series;
      bestDistance = distance;
    }
  }
  return best;
}

export function resolveLegSelection(input: ResolveLegSelectionInput): SelectionResolution {
  const ranks = distinctRanks(input.structure);
  if (input.strikes.length !== ranks.length) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        path: "legs.strikes",
        message: "strikes.length must equal the number of distinct strike ranks",
      },
    };
  }

  const calendar = sortedCalendar(input.view.calendar);
  const atSession = sessionAtOrBefore(calendar, input.at);
  if (!atSession) {
    return {
      ok: false,
      error: {
        code: "insufficient_data",
        needed: {
          from: input.at,
          to: input.at,
          instruments: [input.underlying],
          timeframes: [],
          collections: ["candles"],
        },
      },
    };
  }
  const atIndex = calendar.indexOf(atSession);

  const listedExpiries = [
    ...new Set(
      input.view.optionSeries
        .filter(
          (series) => series.underlying === input.underlying && isAtOrBefore(series.asOf, input.at),
        )
        .map((series) => series.expiry),
    ),
  ];
  const candidateExpiries = listedExpiries
    .map((expiry) => {
      const index = calendar.findIndex((session) => session.date === expiry);
      if (index < 0 || index <= atIndex) return null;
      return { expiry, sessionsAfter: index - atIndex };
    })
    .filter((c): c is { expiry: SessionDate; sessionsAfter: number } => c !== null)
    .filter((c) => c.sessionsAfter >= input.expiry.min && c.sessionsAfter <= input.expiry.max)
    .sort((a, b) => a.sessionsAfter - b.sessionsAfter);

  if (candidateExpiries.length === 0) {
    return {
      ok: false,
      error: {
        code: "no_series_matches",
        underlying: input.underlying,
        strikes: [...input.strikes],
        expiry: input.expiry,
      },
    };
  }
  const chosenExpiry = assertDefined(
    candidateExpiries[0],
    "candidateExpiries is non-empty here",
  ).expiry;

  const tteResult = resolveTimeToExpiryYears(input.view.calendar, input.at, chosenExpiry);
  // chosenExpiry came from candidateExpiries, which already required it to be a listed
  // calendar session strictly after the session of `at` (Q43's business_days window), so
  // resolveTimeToExpiryYears cannot fail here; an expired series never reaches this point.
  invariant(tteResult.ok, "chosenExpiry must resolve a time to expiry: it passed the window check");
  const timeToExpiryYears = tteResult.years;

  const resolvedStrikes: DecimalString[] = [];
  for (const [i, rank] of ranks.entries()) {
    const rule = assertDefined(
      input.strikes[i],
      "strikes.length equals ranks.length, checked above",
    );
    const rightsAtRank = [
      ...new Set(
        input.structure.legs
          .filter((leg) => leg.role !== "stock" && leg.strikeRank === rank)
          .map((leg) => leg.role),
      ),
    ] as ("call" | "put")[];
    const candidates = input.view.optionSeries.filter(
      (series) =>
        series.underlying === input.underlying &&
        series.expiry === chosenExpiry &&
        rightsAtRank.includes(series.right) &&
        isAtOrBefore(series.asOf, input.at),
    );
    if (candidates.length === 0) {
      return {
        ok: false,
        error: {
          code: "no_series_matches",
          underlying: input.underlying,
          strikes: [...input.strikes],
          expiry: input.expiry,
        },
      };
    }

    let chosen: OptionSeries | null = null;
    if (rule.kind === "nearest") {
      chosen = nearestSeriesByStrike(candidates, parseDecimal(rule.price));
    } else if (rule.kind === "moneyness") {
      const target = parseDecimal(input.spot).mul(new Decimal(1).add(parseDecimal(rule.percent)));
      chosen = nearestSeriesByStrike(candidates, target);
    } else {
      // A shared strike rank can list both rights (a straddle): the governing delta is
      // the first right the structure declares at that rank (`rightsAtRank[0]`, insertion
      // order over `structure.legs`), never a best-of-both or an average across rights,
      // since the two legs must land on one strike (PR #53 round 1 item 13).
      chosen = nearestSeriesByAbsDelta(
        candidates.filter((series) => series.right === rightsAtRank[0]),
        parseDecimal(rule.target),
        input.view,
        input.at,
        input.spot,
        input.riskFreeRate,
        input.dividendYield,
        timeToExpiryYears,
      );
    }
    if (!chosen) {
      return {
        ok: false,
        error: {
          code: "no_series_matches",
          underlying: input.underlying,
          strikes: [...input.strikes],
          expiry: input.expiry,
        },
      };
    }
    resolvedStrikes.push(chosen.strike);
  }

  for (let i = 1; i < resolvedStrikes.length; i += 1) {
    const current = resolvedStrikes[i];
    const previous = resolvedStrikes[i - 1];
    if (
      current !== undefined &&
      previous !== undefined &&
      parseDecimal(current).lte(parseDecimal(previous))
    ) {
      return {
        ok: false,
        error: {
          code: "degenerate_strikes",
          underlying: input.underlying,
          strikes: [...input.strikes],
          resolved: resolvedStrikes,
        },
      };
    }
  }

  const legs: ResolvedStructureLeg[] = [];
  for (const [templateIndex, template] of input.structure.legs.entries()) {
    if (template.role === "stock") {
      legs.push({ templateIndex, role: "stock" });
      continue;
    }
    const strike = assertDefined(
      resolvedStrikes[template.strikeRank - 1],
      "every strike rank was resolved above",
    );
    const series = input.view.optionSeries.find(
      (candidate) =>
        candidate.underlying === input.underlying &&
        candidate.expiry === chosenExpiry &&
        candidate.right === template.role &&
        candidate.strike === strike &&
        isAtOrBefore(candidate.asOf, input.at),
    );
    if (!series) {
      return {
        ok: false,
        error: {
          code: "no_series_matches",
          underlying: input.underlying,
          strikes: [...input.strikes],
          expiry: input.expiry,
        },
      };
    }
    legs.push({ templateIndex, role: template.role, series });
  }

  return { ok: true, legs, expiry: chosenExpiry };
}
