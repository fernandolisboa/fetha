import type { PayoffPoint } from "@fetha/engine";

export const PAYOFF_SPARK_VIEW_WIDTH = 100;
export const PAYOFF_SPARK_VIEW_HEIGHT = 34;
const PADDING = 2;

export interface PayoffSparkline {
  linePath: string;
  upAreaPath: string;
  downAreaPath: string;
  zeroY: number;
}

// The compact row's spark (ticket: card B): the engine's own expiry payoff, scaled to the fixed
// viewBox above so the SVG stretches to whatever width the row's layout gives it, with the up and
// down areas split at the zero-pnl line like the full chart's gain/loss areas. Values become
// plain numbers only as drawing coordinates, same as the full payoff chart's own layout helpers;
// nothing here is read back as money. Fewer than two points draws nothing.
export function buildPayoffSparkline(payoff: readonly PayoffPoint[]): PayoffSparkline | null {
  if (payoff.length < 2) return null;

  const values = payoff.map((point) => point.pnl);
  const low = Math.min(...values, 0);
  const high = Math.max(...values, 0);
  const span = high - low;
  const innerWidth = PAYOFF_SPARK_VIEW_WIDTH - 2 * PADDING;
  const innerHeight = PAYOFF_SPARK_VIEW_HEIGHT - 2 * PADDING;

  const x = (index: number): number =>
    PADDING + (values.length === 1 ? 0 : (index / (values.length - 1)) * innerWidth);
  const y = (value: number): number =>
    span === 0 ? PAYOFF_SPARK_VIEW_HEIGHT / 2 : PADDING + (1 - (value - low) / span) * innerHeight;

  const zeroY = y(0);
  const lastX = x(values.length - 1);
  const firstX = x(0);

  const linePath = values
    .map(
      (value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`,
    )
    .join("");

  const upAreaPath =
    "M" +
    values
      .map((value, index) => `${x(index).toFixed(2)},${y(Math.max(value, 0)).toFixed(2)}`)
      .join("L") +
    `L${lastX.toFixed(2)},${zeroY.toFixed(2)}L${firstX.toFixed(2)},${zeroY.toFixed(2)}Z`;

  const downAreaPath =
    "M" +
    values
      .map((value, index) => `${x(index).toFixed(2)},${y(Math.min(value, 0)).toFixed(2)}`)
      .join("L") +
    `L${lastX.toFixed(2)},${zeroY.toFixed(2)}L${firstX.toFixed(2)},${zeroY.toFixed(2)}Z`;

  return { linePath, upAreaPath, downAreaPath, zeroY };
}
