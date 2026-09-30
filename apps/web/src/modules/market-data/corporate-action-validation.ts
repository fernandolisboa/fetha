import { quantitySchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import { z } from "zod";

// A `"use server"` file may only export async functions (Next.js rejects
// anything else at build time), so this Zod schema lives in its own plain
// module (mirrors nightly/validation.ts).
export const recordCorporateActionFactorInputSchema = z
  .object({
    ticker: tickerSchema,
    exDate: sessionDateSchema,
    sharesBefore: quantitySchema,
    sharesAfter: quantitySchema,
  })
  .strict();

export type RecordCorporateActionFactorInput = z.infer<
  typeof recordCorporateActionFactorInputSchema
>;
