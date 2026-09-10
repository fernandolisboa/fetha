import type {
  Centavos,
  Confidence,
  DecimalString,
  Quantity,
  SignedQuantity,
} from "@fetha/contracts";

export function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

export function centavos(value: number): Centavos {
  return value as Centavos;
}

export function quantity(value: number): Quantity {
  return value as Quantity;
}

export function signedQuantity(value: number): SignedQuantity {
  return value as SignedQuantity;
}

export function confidence(value: string): Confidence {
  return value as Confidence;
}
