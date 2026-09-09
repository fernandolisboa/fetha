import { z } from "zod";

export const instrumentOptionSeriesSchema = z.object({
  ticker: z.string().min(1),
  underlying: z.string().min(1),
  right: z.enum(["call", "put"]),
  strike: z.string(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  style: z.enum(["american", "european"]),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type InstrumentOptionSeries = z.infer<typeof instrumentOptionSeriesSchema>;
