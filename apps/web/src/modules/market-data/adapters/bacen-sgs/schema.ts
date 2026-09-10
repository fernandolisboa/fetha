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
