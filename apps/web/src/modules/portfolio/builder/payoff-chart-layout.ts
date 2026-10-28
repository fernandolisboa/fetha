const AXIS_PRICE = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function formatAxisPrice(value: number): string {
  return AXIS_PRICE.format(value);
}

// The pointer snaps to the engine's own samples (each strike, each break-even, 0.8/1/1.2 of spot),
// so the read-out never shows a value the engine did not compute.
export function nearestIndex(xs: readonly number[], x: number): number | null {
  let nearest: number | null = null;
  xs.forEach((candidate, index) => {
    const best = nearest === null ? undefined : xs[nearest];
    if (best === undefined || Math.abs(candidate - x) < Math.abs(best - x)) nearest = index;
  });
  return nearest;
}

// Break-even labels sit above the zero line; one closer than `minGap` pixels to the label before it
// drops below the line instead, so a narrow butterfly's two labels never print over each other.
export function staggeredBelow(xs: readonly number[], minGap: number): boolean[] {
  const below: boolean[] = [];
  xs.forEach((x, index) => {
    const previous = xs[index - 1];
    const previousBelow = below[index - 1] ?? true;
    below.push(previous !== undefined && !previousBelow && x - previous < minGap);
  });
  return below;
}

// A max gain or max loss guide is drawn only where it falls inside the plotted range: a long stock
// leg's max loss sits at a price of zero, far left of the 0.8x spot the chart starts at.
export function guideVisible(pnl: number, maxAbsPnl: number): boolean {
  return pnl !== 0 && Math.abs(pnl) <= maxAbsPnl;
}

// A guide's label baseline: on the side away from zero (above a gain, below a loss) unless that
// would leave the plot, then on the other side.
export function guideLabelY(
  y: number,
  side: "gain" | "loss",
  innerHeight: number,
  lineHeight: number,
): number {
  const above = y - 4;
  const below = y + lineHeight;
  if (side === "gain") return above - lineHeight + 4 < 0 ? below : above;
  return below > innerHeight ? above : below;
}

type Sample = { underlying: number; pnl: number };

// Where the payoff bends: each sample whose slope differs on its two sides (a strike), plus the
// break-evens and the spot.
function kinks(samples: readonly Sample[]): number[] {
  const slope = (a: Sample, b: Sample) => (b.pnl - a.pnl) / (b.underlying - a.underlying);
  return samples.flatMap((sample, index) => {
    const before = samples[index - 1];
    const after = samples[index + 1];
    if (!before || !after) return [];
    return Math.abs(slope(before, sample) - slope(sample, after)) > 1e-9 ? [sample.underlying] : [];
  });
}

// The engine samples 0.8x to 1.2x of spot, so a one-point spread near expiry bends inside a sliver
// of the chart. The focused window spans the kinks, break-evens and spot with a margin of three
// quarters of that span, at least 5% of spot each side, and never leaves the sampled range.
export function focusWindow(
  samples: readonly Sample[],
  spot: number,
  breakEvens: readonly number[],
): [number, number] {
  const first = samples[0]?.underlying ?? spot;
  const last = samples.at(-1)?.underlying ?? spot;
  const marks = [...kinks(samples), ...breakEvens, spot];
  const low = Math.min(...marks);
  const high = Math.max(...marks);
  const margin = Math.max((high - low) * 0.75, spot * 0.05);
  return [Math.max(first, low - margin), Math.min(last, high + margin)];
}

// The payoff at expiry is linear between the engine's samples, so the value where the focused
// window cuts the line is exact; it only sizes the y axis and is never printed.
export function pnlAt(samples: readonly Sample[], underlying: number): number {
  const after = samples.findIndex((sample) => sample.underlying >= underlying);
  if (after <= 0) return (after === 0 ? samples[0] : samples.at(-1))?.pnl ?? 0;
  const a = samples[after - 1];
  const b = samples[after];
  if (!a || !b) return 0;
  return a.pnl + ((b.pnl - a.pnl) * (underlying - a.underlying)) / (b.underlying - a.underlying);
}
