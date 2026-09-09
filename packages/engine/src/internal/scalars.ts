import type { Centavos, Quantity } from "@fetha/contracts";
import { centavosSchema, quantitySchema } from "./scalar-schemas";

export function toQuantity(value: number): Quantity {
  return quantitySchema.parse(value);
}

export function toCentavos(value: number): Centavos {
  return centavosSchema.parse(value);
}
