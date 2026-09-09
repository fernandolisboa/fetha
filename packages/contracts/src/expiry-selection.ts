import { z } from "zod";

export const expirySelectionKinds = ["business_days"] as const;

export const expirySelectionSchema = z
  .strictObject({
    kind: z.literal("business_days"),
    min: z.int().min(1),
    max: z.int().min(1),
  })
  .refine((window) => window.max >= window.min, {
    message: "max must be greater than or equal to min",
    path: ["max"],
  });
export type ExpirySelection = z.infer<typeof expirySelectionSchema>;
