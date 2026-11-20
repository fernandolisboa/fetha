import { Decimal } from "decimal.js";
import { centavosSchema, type Centavos, type DecimalString } from "@fetha/contracts";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatSessionDate } from "@/lib/format/date-time";
import { exitText } from "@/modules/recipes";
import { PayoffChart, RiskNotice } from "@/modules/portfolio/client";

import type { BuildPlanActionInput, BuildPlanOutcome, PlanLegSeries } from "../actions";
import { t } from "../strings";
import { SavePlanButton } from "./save-plan-button";

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line-soft flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</p>
      <p className="font-mono text-[18px] tabular-nums">{value}</p>
    </div>
  );
}

function instrumentText(
  leg: { role: "stock" | "call" | "put"; side: "buy" | "sell"; ticker: string },
  series: PlanLegSeries | undefined,
): string {
  if (leg.role === "stock" || !series) return t.screen.orders.stock(leg.ticker);
  const strike = formatPriceBRL(series.strike);
  const expiry = formatSessionDate(series.expiry);
  return leg.role === "call"
    ? t.screen.orders.call(leg.ticker, strike, expiry)
    : t.screen.orders.put(leg.ticker, strike, expiry);
}

function riskUsedText(maxLoss: number | "unbounded", riskLimitCentavos: number): string {
  if (maxLoss === "unbounded" || riskLimitCentavos <= 0) return "—";
  return `${((maxLoss / riskLimitCentavos) * 100).toFixed(0)}%`;
}

// One real-money total per leg: a `decimal.js` multiplication of the limit price (a
// `DecimalString`) by the lot's quantity, never a raw `Number()` on a price string
// (CLAUDE.md principle 5 — round 1 review item 5).
function legTotalCentavos(limitPrice: DecimalString, quantity: number): Centavos {
  return centavosSchema.parse(new Decimal(limitPrice).mul(100).mul(quantity).round().toNumber());
}

export function PlanScreen({
  outcome,
  riskLimitCentavos,
  cashTodayCentavos,
  input,
}: {
  outcome: Extract<BuildPlanOutcome, { status: "ok" }>;
  riskLimitCentavos: number;
  cashTodayCentavos: Centavos;
  input: BuildPlanActionInput;
}) {
  const { plan, seriesByTicker, fingerprint } = outcome;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[15px] text-pretty">{plan.summary}</p>

      {plan.limitBreaches.length > 0 && <RiskNotice breaches={plan.limitBreaches} />}

      <div className="grid grid-cols-2 gap-4 @min-[40rem]:grid-cols-5">
        <StatBlock
          label={t.screen.numbers.maxLoss}
          value={
            plan.maxLossCentavos === "unbounded"
              ? t.screen.numbers.unbounded
              : formatBRL(plan.maxLossCentavos)
          }
        />
        <StatBlock
          label={t.screen.numbers.maxGain}
          value={
            plan.maxGainCentavos === "unbounded"
              ? t.screen.numbers.unbounded
              : formatBRL(plan.maxGainCentavos)
          }
        />
        <StatBlock
          label={t.screen.numbers.breakEvens}
          value={
            plan.breakEvens.length > 0
              ? plan.breakEvens.map((value) => formatPriceBRL(value)).join(" / ")
              : "—"
          }
        />
        <StatBlock
          label={t.screen.numbers.cashToday}
          value={formatBRL(centavosSchema.parse(cashTodayCentavos))}
        />
        <StatBlock
          label={t.screen.numbers.riskUsed}
          value={riskUsedText(plan.maxLossCentavos, riskLimitCentavos)}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium">{t.screen.orders.title}</h2>
        <Table stacked>
          <TableHeader>
            <TableRow>
              <TableHead>{t.screen.orders.instrument}</TableHead>
              <TableHead className="text-right">{t.screen.orders.quantity}</TableHead>
              <TableHead className="text-right">{t.screen.orders.limitPrice}</TableHead>
              <TableHead className="text-right">{t.screen.orders.total}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.legs.map(({ leg, limitPrice }) => (
              <TableRow key={`${leg.side}-${leg.ticker}`}>
                <TableCell
                  data-stack="title"
                  className="font-medium"
                  style={{ color: leg.side === "buy" ? "var(--up)" : "var(--down)" }}
                >
                  {leg.side === "buy" ? t.screen.orders.buy : t.screen.orders.sell}
                </TableCell>
                <TableCell data-label={t.screen.orders.instrument} data-stack="full">
                  {instrumentText(leg, seriesByTicker[leg.ticker])}
                </TableCell>
                <TableCell
                  data-label={t.screen.orders.quantity}
                  className="text-right font-mono tabular-nums"
                >
                  {leg.quantity}
                </TableCell>
                <TableCell
                  data-label={t.screen.orders.limitPrice}
                  className="text-right font-mono tabular-nums"
                >
                  {formatPriceBRL(limitPrice)}
                </TableCell>
                <TableCell
                  data-label={t.screen.orders.total}
                  className="text-right font-mono tabular-nums"
                >
                  {formatBRL(legTotalCentavos(limitPrice, leg.quantity))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <PayoffChart
        points={plan.payoff}
        pointsNow={plan.payoffNow}
        spot={plan.spot}
        breakEvens={plan.breakEvens}
        maxGain={plan.maxGainCentavos}
        maxLoss={plan.maxLossCentavos}
        spotLabel={formatPriceBRL(plan.spot)}
        framed
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium">{t.screen.rules.title}</h2>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {plan.exitRules.map((resolved, index) => (
            <li key={index} className="flex flex-wrap items-baseline gap-2">
              <span>{exitText(resolved.rule)}</span>
              {resolved.session && (
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {formatSessionDate(resolved.session)}
                </span>
              )}
            </li>
          ))}
          <li className="flex flex-wrap items-baseline gap-2">
            <span className="text-muted-foreground">{t.screen.rules.rollLabel}:</span>
            <span>
              {plan.roll.applies
                ? plan.roll.session
                  ? t.screen.rules.rollApplies(formatSessionDate(plan.roll.session))
                  : t.screen.rules.rollApplies("—")
                : t.screen.rules.rollDoesNotApply}
            </span>
          </li>
        </ul>
      </section>

      <SavePlanButton input={input} fingerprint={fingerprint} />
    </div>
  );
}
