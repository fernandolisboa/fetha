import type { Centavos, Quantity } from "@fetha/contracts";

export function toQuantity(value: number): Quantity {
  return value as Quantity;
}

export function toCentavos(value: number): Centavos {
  return value as Centavos;
}
