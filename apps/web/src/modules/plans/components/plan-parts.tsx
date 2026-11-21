import { Decimal } from "decimal.js";
import { centavosSchema, type Centavos, type DecimalString } from "@fetha/contracts";

import type { PlanLegSeries } from "../actions";
import { instrumentLabel } from "../instrument-label";
import { t } from "../strings";

// Shared, presentation-only pieces of the plan screen (ticket #379) and the drag-to-adjust
// screen built on top of it (ticket #380): kept apart from both so neither imports the other
// just to reach a `<StatBlock>`.
export function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line-soft flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</p>
      <p className="font-mono text-[18px] tabular-nums">{value}</p>
    </div>
  );
}

// `instrumentLabel` (round 4 review) names the underlying, not the option's own series ticker;
// this still shows that series ticker as a second, muted line, for placing the order at the
// broker, for an option leg only — a stock leg's own ticker is already the label.
export function InstrumentCell({
  leg,
  series,
}: {
  leg: { role: "stock" | "call" | "put"; side: "buy" | "sell"; ticker: string };
  series: PlanLegSeries | undefined;
}) {
  const label = instrumentLabel(leg, series);
  if (leg.role === "stock" || !series) return <>{label}</>;
  return (
    <span className="flex flex-col gap-0.5">
      <span>{label}</span>
      <span className="text-muted-foreground text-xs">
        {t.screen.orders.seriesCode(leg.ticker)}
      </span>
    </span>
  );
}

export function riskUsedText(maxLoss: number | "unbounded", riskLimitCentavos: number): string {
  if (maxLoss === "unbounded" || riskLimitCentavos <= 0) return "—";
  return `${((maxLoss / riskLimitCentavos) * 100).toFixed(0)}%`;
}

// One real-money total per leg: a `decimal.js` multiplication of the limit price (a
// `DecimalString`) by the lot's quantity, never a raw `Number()` on a price string
// (CLAUDE.md principle 5 — round 1 review item 5).
export function legTotalCentavos(limitPrice: DecimalString, quantity: number): Centavos {
  return centavosSchema.parse(new Decimal(limitPrice).mul(100).mul(quantity).round().toNumber());
}
