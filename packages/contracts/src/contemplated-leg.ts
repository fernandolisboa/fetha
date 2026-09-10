import { z } from "zod";
import { legRoles, legSides } from "./structure";
import { quantitySchema, tickerSchema } from "./scalars";

// The persisted shape of a leg inside a Contemplated Operation
// (UBIQUITOUS_LANGUAGE.md): a concrete ticker and quantity, not a
// template's strikeRank. Named apart from the engine's own `OperationLeg`
// (which carries `entryPrice`, `@fetha/engine`'s `api.ts`) so the two never
// collide under one import.
export const contemplatedLegSchema = z.strictObject({
  role: z.enum(legRoles),
  side: z.enum(legSides),
  ticker: tickerSchema,
  quantity: quantitySchema,
});
export type ContemplatedLeg = z.infer<typeof contemplatedLegSchema>;
