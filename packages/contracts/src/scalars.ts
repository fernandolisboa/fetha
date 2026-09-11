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

// Bounded well below Number.MAX_SAFE_INTEGER (PR #76 round 2 item 9): a
// quantity that large would let the engine's own centavos math
// (quantity * price, then rounded) overflow past a safe integer and throw
// inside `toCentavos` deep in a server action instead of failing here,
// at the edge, with a typed Zod error. No realistic personal-portfolio
// position approaches one million units of a single instrument.
const MAX_QUANTITY = 1_000_000;

export const quantitySchema = z.int().positive().max(MAX_QUANTITY).brand<"Quantity">();
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

// Mirrors `@fetha/engine`'s `optionRights`/`exerciseStyles`/`macroSeriesKinds`
// (packages/engine/src/api.ts) by value, not by import: the engine depends
// on `@fetha/contracts`, so the dependency cannot run the other way. Any
// value the database can hold for these columns must parse here rather than
// be cast at the read site (round 2 item 4).
export const optionRightSchema = z.enum(["call", "put"]);
export type OptionRight = z.infer<typeof optionRightSchema>;

export const exerciseStyleSchema = z.enum(["american", "european"]);
export type ExerciseStyle = z.infer<typeof exerciseStyleSchema>;

export const macroSeriesKindSchema = z.enum(["cdi", "selic", "ipca"]);
export type MacroSeriesKind = z.infer<typeof macroSeriesKindSchema>;
