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
import { assertDefined } from "./invariant";
import { priceOptionLeg } from "./option-pricing";
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

function nearestSeriesByStrike(
  candidates: readonly OptionSeries[],
  target: Decimal,
): OptionSeries | null {
  let best: OptionSeries | null = null;
  let bestDistance: Decimal | null = null;
  for (const series of candidates) {
    const distance = parseDecimal(series.strike).sub(target).abs();
    if (bestDistance === null || distance.lt(bestDistance)) {
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
    const priceRow = view.optionPrices.find(
      (p) => p.ticker === series.ticker && isAtOrBefore(p.asOf, at),
    );
    const marketPrice = priceRow?.close ?? priceRow?.average ?? null;
    if (!marketPrice) continue;
    const valuation = priceOptionLeg({
      leg: { role: series.right, side: "buy", ticker: series.ticker, quantity: toQuantity(1) },
      strike: series.strike,
      spot,
      riskFreeRate,
      dividendYield,
      timeToExpiryYears,
      marketPrice: {
        value: marketPrice,
        source: priceRow?.close ? "close" : "average",
        stale: null,
      },
      givenVolatility: null,
    });
    if (!valuation.greeks) continue;
    const distance = new Decimal(valuation.greeks.delta).abs().sub(target).abs();
    if (bestDistance === null || distance.lt(bestDistance)) {
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
  const timeToExpiryYears = tteResult.ok ? tteResult.years : 0;

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
