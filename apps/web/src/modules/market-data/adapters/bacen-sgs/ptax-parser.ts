import { decimalStringSchema } from "@fetha/contracts";
import Decimal from "decimal.js";

import { toIsoDate } from "./parser";
import type { ExchangeRatePair, ExchangeRatePoint } from "./schema";
import { exchangeRatePointSchema, sgsResponseSchema } from "./schema";

// The Bacen fixing instant (ADR-0059): PTAX is published around 13h and
// closed at 13:30 America/Sao_Paulo (UTC-3 year-round; Brazil has not
// observed DST since 2019), a fixed publication instant independent of any
// trading-session open/close this module otherwise carries.
const PTAX_PUBLICATION_UTC_TIME = "16:30:00.000Z";

export function ptaxAsOf(date: string): string {
  return `${date}T${PTAX_PUBLICATION_UTC_TIME}`;
}

// Unlike `parseSgsResponse`, this never filters by a trading-session
// calendar: Bacen's own business-day calendar for PTAX differs from B3's
// (ADR-0059), so a date B3 would not treat as a session is still a real,
// published PTAX point and is kept.
export function parsePtaxResponse(pair: ExchangeRatePair, body: unknown): ExchangeRatePoint[] {
  const points = sgsResponseSchema.parse(body).filter((point) => point.valor.trim() !== "");
  return points.map((point) => {
    // Decimal's own error quotes its input, and this message can reach the
    // nightly report, which must never carry provider text (#289).
    if (!decimalStringSchema.safeParse(point.valor).success) {
      throw new Error(`PTAX returned a non-numeric value for ${pair} on ${point.data}`);
    }
    const date = toIsoDate(point.data);
    return exchangeRatePointSchema.parse({
      pair,
      date,
      asOf: ptaxAsOf(date),
      rate: new Decimal(point.valor).toFixed(8),
    });
  });
}
