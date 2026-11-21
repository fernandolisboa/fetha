import {
  decimalStringSchema,
  indicatorSpecSchema,
  sessionDateSchema,
  tickerSchema,
  type IndicatorSpec,
} from "@fetha/contracts";
import { z } from "zod";

// The identity an indicator spec is deduplicated and matched by (its kind plus the one length
// parameter that distinguishes two specs of the same kind): shared by the radar's own read of an
// underlying and anything that later matches a condition's indicator against today's facts.
export function indicatorSpecKey(spec: IndicatorSpec): string {
  return spec.kind === "iv_rank"
    ? `iv_rank:${String(spec.lookbackSessions)}`
    : `${spec.kind}:${String(spec.length)}`;
}

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
