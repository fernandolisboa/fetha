import { z } from "zod";

export const sgsRawPointSchema = z.object({
  data: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  valor: z.string(),
});
export type SgsRawPoint = z.infer<typeof sgsRawPointSchema>;

export const sgsResponseSchema = z.array(sgsRawPointSchema);

export const macroSeriesKindSchema = z.enum(["cdi", "selic", "ipca"]);
export type MacroSeriesKind = z.infer<typeof macroSeriesKindSchema>;

export const macroPointSchema = z.object({
  series: macroSeriesKindSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  annualRate: z.string(),
});
export type MacroPoint = z.infer<typeof macroPointSchema>;

// series 12 (CDI, % a.d.) and 433 (IPCA, % a.m.) are compounded to an
// annual rate; series 432 (Selic meta/target, % a.a.) already is one, so it
// maps straight through with no assumption. Series 11 (Selic efetiva, % a.d.)
// is documented in ADR-0017 as fetchable but not currently surfaced: the
// engine's MacroPoint has no slot for "Selic realized daily" distinct from
// the target rate 432 already gives without a compounding assumption.
export const sgsSeriesCodes = {
  cdi: 12,
  selic: 432,
  ipca: 433,
} as const satisfies Record<MacroSeriesKind, number>;

export const sgsSelicDailySeriesCode = 11;
