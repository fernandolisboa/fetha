import {
  decimalStringSchema,
  indicatorSpecSchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";
import { z } from "zod";

// What the radar stores for a recipe that found an entry (docs/adr/0066): the close and every
// entry indicator the engine read at the scanned session, and the legs one unit of the recipe's
// structure resolved to. Validated on write and on read, since `radar_matches` is jsonb.
export const radarFactsSchema = z.strictObject({
  close: decimalStringSchema,
  indicators: z.array(
    z.strictObject({ indicator: indicatorSpecSchema, value: decimalStringSchema.nullable() }),
  ),
});
export type RadarFacts = z.infer<typeof radarFactsSchema>;

export const radarLegSchema = z.strictObject({
  role: z.enum(["stock", "call", "put"]),
  side: z.enum(["buy", "sell"]),
  ticker: tickerSchema,
  strike: decimalStringSchema.nullable(),
  expiry: sessionDateSchema.nullable(),
});
export type RadarLeg = z.infer<typeof radarLegSchema>;

export const radarLegsSchema = z.array(radarLegSchema).min(1);
