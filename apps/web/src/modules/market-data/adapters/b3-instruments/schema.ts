import { decimalStringSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import { z } from "zod";

export const instrumentOptionSeriesSchema = z.object({
  ticker: tickerSchema,
  isin: z.string().min(1),
  underlying: tickerSchema,
  right: z.enum(["call", "put"]),
  strike: decimalStringSchema,
  expiry: sessionDateSchema,
  style: z.enum(["american", "european"]),
  asOf: sessionDateSchema,
});
export type InstrumentOptionSeries = z.infer<typeof instrumentOptionSeriesSchema>;
