import type { SketchPoint } from "../payoff-sketch";

const WIDTH = 120;
const HEIGHT = 40;
const PAD = 3;

function toX(x: number): number {
  return PAD + x * (WIDTH - 2 * PAD);
}

function toY(y: number): number {
  return HEIGHT / 2 - y * (HEIGHT / 2 - PAD);
}

function coordinate(x: number, y: number): string {
  return `${String(toX(x))},${String(toY(y))}`;
}

function area(points: readonly SketchPoint[], clamp: (y: number) => number): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  const curve = points.map((point) => coordinate(point.x, clamp(point.y))).join(" ");
  return `${coordinate(first.x, 0)} ${curve} ${coordinate(last.x, 0)}`;
}

export function PayoffSketchSvg({ points, label }: { points: SketchPoint[]; label: string }) {
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <polygon points={area(points, (y) => Math.max(y, 0))} fill="var(--up)" opacity={0.12} />
      <polygon points={area(points, (y) => Math.min(y, 0))} fill="var(--down)" opacity={0.12} />
      <line
        x1={PAD}
        x2={WIDTH - PAD}
        y1={toY(0)}
        y2={toY(0)}
        stroke="var(--muted)"
        strokeDasharray="3,3"
      />
      <polyline
        points={points.map((point) => coordinate(point.x, point.y)).join(" ")}
        fill="none"
        stroke="var(--chart-stroke)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
