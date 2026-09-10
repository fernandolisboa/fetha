import { decimalStringSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import { z } from "zod";

export const cotahistStockRowSchema = z.object({
  kind: z.literal("stock"),
  session: sessionDateSchema,
  ticker: tickerSchema,
  open: decimalStringSchema,
  high: decimalStringSchema,
  low: decimalStringSchema,
  average: decimalStringSchema,
  close: decimalStringSchema,
  trades: z.number().int().nonnegative(),
  tradedQuantity: z.number().int().nonnegative(),
});
export type CotahistStockRow = z.infer<typeof cotahistStockRowSchema>;

export const cotahistOptionRowSchema = z.object({
  kind: z.literal("option"),
  session: sessionDateSchema,
  ticker: tickerSchema,
  right: z.enum(["call", "put"]),
  strike: decimalStringSchema,
  expiry: sessionDateSchema,
  factor: decimalStringSchema,
  open: decimalStringSchema,
  high: decimalStringSchema,
  low: decimalStringSchema,
  average: decimalStringSchema,
  close: decimalStringSchema,
  trades: z.number().int().nonnegative(),
  tradedQuantity: z.number().int().nonnegative(),
});
export type CotahistOptionRow = z.infer<typeof cotahistOptionRowSchema>;

export const cotahistRowSchema = z.discriminatedUnion("kind", [
  cotahistStockRowSchema,
  cotahistOptionRowSchema,
]);
export type CotahistRow = z.infer<typeof cotahistRowSchema>;
