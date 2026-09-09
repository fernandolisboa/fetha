import { z } from "zod";

export const cotahistStockRowSchema = z.object({
  kind: z.literal("stock"),
  session: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ticker: z.string().min(1),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  average: z.string(),
  close: z.string(),
  trades: z.number().int().nonnegative(),
  tradedQuantity: z.number().int().nonnegative(),
});
export type CotahistStockRow = z.infer<typeof cotahistStockRowSchema>;

export const cotahistOptionRowSchema = z.object({
  kind: z.literal("option"),
  session: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ticker: z.string().min(1),
  right: z.enum(["call", "put"]),
  strike: z.string(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  factor: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  average: z.string(),
  close: z.string(),
  trades: z.number().int().nonnegative(),
  tradedQuantity: z.number().int().nonnegative(),
});
export type CotahistOptionRow = z.infer<typeof cotahistOptionRowSchema>;

export const cotahistRowSchema = z.discriminatedUnion("kind", [
  cotahistStockRowSchema,
  cotahistOptionRowSchema,
]);
export type CotahistRow = z.infer<typeof cotahistRowSchema>;
