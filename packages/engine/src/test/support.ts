import type {
  Centavos,
  Confidence,
  DecimalString,
  Quantity,
  SignedQuantity,
} from "@fetha/contracts";
import type { TradingSession } from "../api";

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

// Shared by every test that needs a run of consecutive 2024-01-DD trading sessions with a
// 13:00-21:00 UTC session (round 1 item 12): mark-to-market, propose-settlement,
// operation-coherence, resolve-leg-selection and price-operation each declared their own copy.
export function dailyCalendar(fromDay: number, count: number): TradingSession[] {
  return Array.from({ length: count }, (_, i) => {
    const day = String(fromDay + i).padStart(2, "0");
    return {
      date: `2024-01-${day}`,
      open: `2024-01-${day}T13:00:00.000Z`,
      close: `2024-01-${day}T21:00:00.000Z`,
    };
  });
}
