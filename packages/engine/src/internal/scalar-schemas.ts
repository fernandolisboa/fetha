// The one place the engine imports @fetha/contracts as a value, not a type: the branded
// scalar constructors below build through these Zod schemas so an out-of-range or malformed
// Quantity, Centavos or DecimalString fails at construction, not at the next comparison. This
// does not import vocabulary (Structure, Condition, ...), which the engine still treats as
// contracts' alone (ADR-0013); eslint.config.js confines the exception to this file.
export { centavosSchema, decimalStringSchema, quantitySchema } from "@fetha/contracts";
