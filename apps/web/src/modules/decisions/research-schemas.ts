import { z } from "zod";
import { centavosSchema, decimalStringSchema, researchAlertSchema } from "@fetha/contracts";

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

export const storedAiAlertsSchema = z.array(researchAlertSchema).max(5);
export const storedInputsCitedSchema = z.array(z.string().min(1));

export const storedDroppedSchema = z.record(z.enum(dropReasons), z.number().int().nonnegative());
