import { z } from "zod";
import { expirySelectionSchema } from "./expiry-selection";
import { strikeSelectionSchema } from "./strike-selection";
import { structureSchema } from "./structure";

// A catalog entry (docs/adr/0053): a structure with the published source
// it is defined from and the strike and expiry selection a new strategy on
// it starts with.
export const catalogEntrySchema = z.strictObject({
  structure: structureSchema,
  defaults: z
    .strictObject({
      strikes: z.array(strikeSelectionSchema).max(8),
      expiry: expirySelectionSchema.optional(),
    })
    .refine((defaults) => defaults.strikes.length === 0 || defaults.expiry !== undefined, {
      message: "expiry is required when the defaults select strikes",
      path: ["expiry"],
    }),
  reference: z.string().min(1),
  notes: z.string().min(1),
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const catalogSchema = z
  .array(catalogEntrySchema)
  .min(1)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.structure.id)).size === entries.length,
    { message: "structure ids must be unique" },
  );
