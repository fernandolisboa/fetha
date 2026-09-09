import { z } from "zod";

export const decimalStringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d+)?$/)
  .brand<"DecimalString">();
export type DecimalString = z.infer<typeof decimalStringSchema>;

export const nonNegativeDecimalSchema = decimalStringSchema.regex(/^[^-]/, {
  message: "must be zero or positive",
});

export const positiveDecimalSchema = nonNegativeDecimalSchema.regex(/[1-9]/, {
  message: "must be strictly positive",
});

export const openUnitIntervalSchema = decimalStringSchema.regex(/^0\.\d*[1-9]\d*$/, {
  message: "must be strictly between 0 and 1",
});

export const leftOpenUnitIntervalSchema = decimalStringSchema.regex(/^(0\.\d*[1-9]\d*|1(\.0+)?)$/, {
  message: "must be greater than 0 and at most 1",
});

export const rightOpenUnitIntervalSchema = decimalStringSchema.regex(/^0(\.\d+)?$/, {
  message: "must be at least 0 and strictly below 1",
});

export const confidenceSchema = decimalStringSchema
  .regex(/^(0(\.\d+)?|1(\.0+)?)$/, { message: "must be between 0 and 1 inclusive" })
  .brand<"Confidence">();
export type Confidence = z.infer<typeof confidenceSchema>;

export const centavosSchema = z.int().brand<"Centavos">();
export type Centavos = z.infer<typeof centavosSchema>;

export const quantitySchema = z.int().positive().brand<"Quantity">();
export type Quantity = z.infer<typeof quantitySchema>;

export const signedQuantitySchema = z
  .int()
  .refine((value) => value !== 0, { message: "a net position is never zero" })
  .brand<"SignedQuantity">();
export type SignedQuantity = z.infer<typeof signedQuantitySchema>;

export const tickerSchema = z.string().regex(/^[A-Z0-9]{4,12}$/);
export type Ticker = z.infer<typeof tickerSchema>;

export const sessionDateSchema = z.iso.date();
export type SessionDate = z.infer<typeof sessionDateSchema>;

export const instantSchema = z.iso.datetime({ precision: 3, offset: false });
export type Instant = z.infer<typeof instantSchema>;
