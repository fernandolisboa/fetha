import {
  decimalStringSchema,
  positiveDecimalSchema,
  sessionDateSchema,
  settlementStyleSchema,
  tickerSchema,
} from "@fetha/contracts";
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
  // B3's own `PricFctr` (ADR-0062/0063): absent defaults to "1" for a physically-settled
  // series, the pre-existing equity-option behaviour; a cash-settled (index-option) row with a
  // blank, unparsable or non-positive factor is dropped as non-conforming by the parser instead
  // of ever reaching this schema with the wrong "1" default (a factor can never be zero or
  // negative: B3 quotes an index option in points per real strictly greater than zero).
  priceFactor: positiveDecimalSchema,
  // The registry's `SctyCtgyNm` ("OPTION ON INDEX" -> "cash", else "physical", ADR-0063).
  settlementStyle: settlementStyleSchema,
});
export type InstrumentOptionSeries = z.infer<typeof instrumentOptionSeriesSchema>;
