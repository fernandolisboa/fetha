import { z } from "zod";

// One column per month, string | null (null on a non-session day or a day not yet
// published); day 1..31, always 31 rows regardless of the month's real length
// (ADR-0062). `min`/`max` are B3's own per-month extrema, unused here.
const monthlyValueSchema = z.string().nullable().optional();

export const indexDayRowSchema = z.object({
  day: z.number().int(),
  rateValue1: monthlyValueSchema,
  rateValue2: monthlyValueSchema,
  rateValue3: monthlyValueSchema,
  rateValue4: monthlyValueSchema,
  rateValue5: monthlyValueSchema,
  rateValue6: monthlyValueSchema,
  rateValue7: monthlyValueSchema,
  rateValue8: monthlyValueSchema,
  rateValue9: monthlyValueSchema,
  rateValue10: monthlyValueSchema,
  rateValue11: monthlyValueSchema,
  rateValue12: monthlyValueSchema,
});
export type IndexDayRow = z.infer<typeof indexDayRowSchema>;

export const monthColumns = [
  "rateValue1",
  "rateValue2",
  "rateValue3",
  "rateValue4",
  "rateValue5",
  "rateValue6",
  "rateValue7",
  "rateValue8",
  "rateValue9",
  "rateValue10",
  "rateValue11",
  "rateValue12",
] as const satisfies readonly (keyof IndexDayRow)[];

// `results: null` for an unknown index or a future year (ADR-0062): HTTP 200,
// not a 404, so the schema itself tells the caller there is nothing to read rather than the
// fetch layer guessing from the status code.
export const indexPortfolioDayResponseSchema = z.object({
  min: z.unknown().optional(),
  max: z.unknown().optional(),
  results: z.array(indexDayRowSchema).nullable(),
});
export type IndexPortfolioDayResponse = z.infer<typeof indexPortfolioDayResponseSchema>;

export interface IndexClosePoint {
  date: string;
  close: string;
}
