import { Decimal } from "decimal.js";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

export const SPARKLINE_SESSIONS = 30;
export const SPARKLINE_WIDTH = 96;
export const SPARKLINE_HEIGHT = 24;
const PADDING = 2;
// A percent printed with two decimals is a fraction with four: rounding once here keeps the
// colour and the printed change in agreement.
const FRACTION_DECIMALS = 4;

export interface Sparkline {
  points: string;
  direction: "up" | "down" | "flat";
  changeFraction: DecimalString;
  sessions: number;
}

// `closes` are oldest first. Fewer than two closes, or a zero first close (no percent change
// to speak of), draws nothing. Closes become plain numbers only as drawing coordinates; the
// printed change stays a decimal.
export function buildSparkline(
  closes: readonly DecimalString[],
  { width = SPARKLINE_WIDTH, height = SPARKLINE_HEIGHT, sessions = SPARKLINE_SESSIONS } = {},
): Sparkline | null {
  const window = closes.slice(-sessions);
  const first = window[0];
  const last = window[window.length - 1];
  if (first === undefined || last === undefined || window.length < 2) return null;

  const firstValue = new Decimal(first);
  if (firstValue.isZero()) return null;
  const lastValue = new Decimal(last);

  const values = window.map((close) => Number(close));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerWidth = width - 2 * PADDING;
  const innerHeight = height - 2 * PADDING;
  const points = values
    .map((value, index) => {
      const x = PADDING + (index / (values.length - 1)) * innerWidth;
      const y = span === 0 ? height / 2 : PADDING + (1 - (value - min) / span) * innerHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const change = lastValue
    .minus(firstValue)
    .div(firstValue.abs())
    .toDecimalPlaces(FRACTION_DECIMALS);
  return {
    points,
    direction: change.isZero() ? "flat" : change.isPositive() ? "up" : "down",
    changeFraction: decimalStringSchema.parse(change.toFixed(FRACTION_DECIMALS)),
    sessions: window.length,
  };
}
