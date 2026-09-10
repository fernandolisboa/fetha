import { z } from "zod";
import { legRoles, legSides } from "./structure";
import { quantitySchema, tickerSchema } from "./scalars";

// The persisted shape of a leg inside a contemplated operation (a concrete
// ticker and quantity, not a template's strikeRank): what the builder saves
// once the user has picked an instrument from the closing chain for each
// leg role the structure describes.
export const operationLegSchema = z.strictObject({
  role: z.enum(legRoles),
  side: z.enum(legSides),
  ticker: tickerSchema,
  quantity: quantitySchema,
});
export type OperationLeg = z.infer<typeof operationLegSchema>;
