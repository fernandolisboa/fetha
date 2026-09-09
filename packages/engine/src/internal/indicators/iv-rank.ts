import Decimal from "decimal.js";

export function ivRank(points: readonly Decimal[], lookbackSessions: number): (Decimal | null)[] {
  return points.map((current, i) => {
    if (i < lookbackSessions - 1) return null;
    const window = points.slice(i - lookbackSessions + 1, i + 1);
    const below = window.filter((v) => v.lt(current)).length;
    return new Decimal(100).mul(below).div(lookbackSessions - 1);
  });
}
