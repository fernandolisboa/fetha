import { z } from "zod";

export const decimalStringSchema = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/);
export type DecimalString = z.infer<typeof decimalStringSchema>;

export const centavosSchema = z.int();
export type Centavos = z.infer<typeof centavosSchema>;

export const quantitySchema = z.int().positive();
export type Quantity = z.infer<typeof quantitySchema>;

export const tickerSchema = z.string().regex(/^[A-Z0-9]{4,12}$/);
export type Ticker = z.infer<typeof tickerSchema>;

export const sessionDateSchema = z.iso.date();
export type SessionDate = z.infer<typeof sessionDateSchema>;

export const instantSchema = z.iso.datetime();
export type Instant = z.infer<typeof instantSchema>;
