import {
  decimalStringSchema,
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
  // B3's own `PricFctr` (ADR-0063): absent or unparsable defaults to "1", the pre-existing
  // equity-option behaviour.
  priceFactor: decimalStringSchema,
  // The registry's `SctyCtgyNm` ("OPTION ON INDEX" -> "cash", else "physical", ADR-0063).
  settlementStyle: settlementStyleSchema,
});
export type InstrumentOptionSeries = z.infer<typeof instrumentOptionSeriesSchema>;
