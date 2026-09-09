import type { Centavos, Quantity } from "@fetha/contracts";
import { invariant } from "./invariant";

export function toQuantity(value: number): Quantity {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    `toQuantity: expected a positive integer, got ${String(value)}`,
  );
  return value as Quantity;
}

export function toCentavos(value: number): Centavos {
  invariant(Number.isSafeInteger(value), `toCentavos: expected an integer, got ${String(value)}`);
  return value as Centavos;
}
