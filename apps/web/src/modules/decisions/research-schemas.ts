import { z } from "zod";
import {
  centavosSchema,
  decimalStringSchema,
  researchAlertSchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";
import {
  impliedVolatilityLabels,
  momentumLabels,
  optionLiquidityLabels,
  rangeLabels,
  trendLabels,
} from "@fetha/engine";

import { dropReasons } from "@/modules/radar";

// What a stored research idea reads back from its `pricing` jsonb (docs/adr/0076): the lot as the
// engine re-priced it at the newest close. Only the fields the card, the decision snapshot and the
// scoring read are checked; the engine's artifact keeps whatever else it carried.
export const storedIdeaPricingSchema = z.looseObject({
  netPremium: centavosSchema,
  maxLoss: centavosSchema,
  maxGain: z.union([centavosSchema, z.literal("unbounded")]),
  breakEvens: z.array(decimalStringSchema),
});
export type StoredIdeaPricing = z.infer<typeof storedIdeaPricingSchema>;

const nullableDecimal = decimalStringSchema.nullable();

// The asset reading as a stored idea carries it: the labels and figures the card draws and the
// facts quote are checked, `notes` and `provenance` are kept as the engine wrote them. The same
// shape is checked before writing and after reading, so a row that no longer fits is dropped
// rather than drawn wrong.
export const storedIdeaReadingSchema = z.looseObject({
  ticker: tickerSchema,
  session: sessionDateSchema.nullable(),
  close: nullableDecimal,
  trend: z.looseObject({ label: z.enum(trendLabels).nullable() }),
  momentum: z.looseObject({ label: z.enum(momentumLabels).nullable() }),
  range: z.looseObject({ label: z.enum(rangeLabels).nullable() }),
  impliedVolatility: z.looseObject({ label: z.enum(impliedVolatilityLabels).nullable() }),
  options: z.looseObject({
    label: z.enum(optionLiquidityLabels),
    tradedSeries: z.int().nonnegative(),
  }),
  notes: z.array(z.unknown()),
  provenance: z.looseObject({}),
});

export const storedAiAlertsSchema = z.array(researchAlertSchema).max(5);
export const storedInputsCitedSchema = z.array(z.string().min(1));

export const storedDroppedSchema = z.record(z.enum(dropReasons), z.number().int().nonnegative());
