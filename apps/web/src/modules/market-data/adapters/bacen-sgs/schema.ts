import { decimalStringSchema, instantSchema, sessionDateSchema } from "@fetha/contracts";
import { z } from "zod";

// valor is a plain string here, not decimalStringSchema: Bacen occasionally
// returns a point with an empty valor (a gap in the series), and the parser
// drops those points rather than failing the whole batch (ADR-0017).
export const sgsRawPointSchema = z.object({
  data: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  valor: z.string(),
});
export type SgsRawPoint = z.infer<typeof sgsRawPointSchema>;

export const sgsResponseSchema = z.array(sgsRawPointSchema);

export const sgsNotFoundBodySchema = z.object({
  erro: z.object({ detail: z.string().includes("Value(s) not found") }),
});

export const macroSeriesKindSchema = z.enum(["cdi", "selic", "ipca"]);
export type MacroSeriesKind = z.infer<typeof macroSeriesKindSchema>;

export const macroPointSchema = z.object({
  series: macroSeriesKindSchema,
  date: sessionDateSchema,
  asOf: instantSchema,
  annualRate: decimalStringSchema,
});
export type MacroPoint = z.infer<typeof macroPointSchema>;

// series 12 (CDI, % a.d.) is compounded to an annual rate; series 432
// (Selic meta/target, % a.a.) and series 13522 (IPCA, 12-month accumulated,
// % a.a.) already are annual rates and pass through unchanged. Series 11
// (Selic efetiva, % a.d.) is documented in ADR-0017 as fetchable but not
// currently surfaced: the engine's MacroPoint has no slot for "Selic
// realized daily" distinct from the target rate 432 already gives.
export const sgsSeriesCodes = {
  cdi: 12,
  selic: 432,
  ipca: 13522,
} as const satisfies Record<MacroSeriesKind, number>;

export const exchangeRatePairSchema = z.enum(["USDBRL", "EURBRL"]);
export type ExchangeRatePair = z.infer<typeof exchangeRatePairSchema>;

export const exchangeRatePairValues = exchangeRatePairSchema.options;

export const exchangeRatePointSchema = z.object({
  pair: exchangeRatePairSchema,
  date: sessionDateSchema,
  asOf: instantSchema,
  rate: decimalStringSchema,
});
export type ExchangeRatePoint = z.infer<typeof exchangeRatePointSchema>;

// SGS series 1 (dollar selling PTAX) and 21619 (euro selling PTAX),
// verified live against api.bcb.gov.br 2026-10-13 (docs/adr/0059).
export const ptaxSgsCodes = {
  USDBRL: 1,
  EURBRL: 21619,
} as const satisfies Record<ExchangeRatePair, number>;
