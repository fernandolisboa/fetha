"use client";

import { startTransition, useMemo, useRef, useState } from "react";
import type { SessionDate, Ticker } from "@fetha/contracts";

import { centavosSchema } from "@fetha/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorNotice } from "@/components/error-notice";
import { formatSessionDate } from "@/lib/format/date-time";
import { formatQuantity } from "@/lib/format/quantity";
import { exitText } from "@/modules/recipes";
import { PayoffChart, RiskNotice, type PayoffStrikeHandle } from "@/modules/portfolio/client";

import {
  adjustPlanAction,
  type BuildPlanActionInput,
  type BuildPlanOutcome,
  type PlanActionError,
} from "../actions";
import {
  allStrikesFor,
  indexOfTicker,
  remapToExpiry,
  selectableStrikes,
  stepStrike,
  tickerAtStrike,
} from "../leg-strikes";
import { LatestRequestWins } from "../latest-wins";
import { diffPlans, type PlanDiffLeg, type PlanSnapshot } from "../plan-diff";
import { stepLots } from "../lot-step";
import { previewPlan } from "../preview-plan";
import { t } from "../strings";
import {
  formatBRL,
  formatPriceBRL,
  InstrumentCell,
  legTotalCentavos,
  riskUsedText,
  StatBlock,
} from "./plan-parts";
import { SavePlanButton } from "./save-plan-button";

type Ok = Extract<BuildPlanOutcome, { status: "ok" }>;

function legsOf(plan: Ok["plan"]): PlanDiffLeg[] {
  return plan.legs.map(({ leg }) => ({ role: leg.role, side: leg.side, ticker: leg.ticker }));
}

function snapshotOf(plan: Ok["plan"]): PlanSnapshot {
  return { lots: plan.lots, legs: legsOf(plan) };
}

function rightOf(outcome: Ok, ticker: Ticker): "call" | "put" | null {
  const series = outcome.seriesByTicker[ticker];
  return series?.right ?? null;
}

function expiryOf(outcome: Ok): SessionDate | null {
  const first = Object.values(outcome.seriesByTicker)[0];
  return first?.expiry ?? null;
}

const sideLabel = { buy: t.screen.orders.buy, sell: t.screen.orders.sell } as const;

// Drag-to-adjust (ticket #380): wraps the read-only plan screen's own numbers, orders, chart and
// rules with editable strike handles drawn directly on the payoff chart's own price axis
// (`PayoffStrikeHandle`, `@/modules/portfolio/client`), the per-leg ← → buttons (the phone and
// screen-reader alternative, not a fallback relegated to a second control — the handle's own
// arrow keys call the exact same `onStrikeStep`), a lot stepper and expiry chips. A client-side
// preview (`previewPlan`, the engine's own pure `priceOperation`) redraws the chart continuously
// while dragging (`previewLegChange`, never hitting the server); `adjustPlanAction` then prices
// the exact same edit on the server once, on release, a lot +/- press or an expiry chip — never
// on every pixel of a drag — and only that reply ever becomes the plan's official numbers
// (`current`) — guarded by `LatestRequestWins` so a slow reply from an earlier edit can never
// overwrite a newer one.
export function PlanAdjuster({
  outcome,
  riskLimitCentavos,
  cashTodayCentavos,
  input,
}: {
  outcome: Ok;
  riskLimitCentavos: number;
  cashTodayCentavos: number;
  input: BuildPlanActionInput;
}) {
  const [original] = useState<Ok>(outcome);
  const [current, setCurrent] = useState<Ok>(outcome);
  const [previewPricing, setPreviewPricing] = useState<Ok["plan"]["payoff"] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PlanActionError | null>(null);
  const sequencer = useRef(new LatestRequestWins());

  const chain = current.chain;
  const expiry = expiryOf(current);
  const changes = useMemo(
    () => diffPlans(snapshotOf(original.plan), snapshotOf(current.plan)),
    [original, current],
  );

  async function commit(legs: PlanDiffLeg[], lots: number) {
    setPending(true);
    setError(null);
    const requestId = sequencer.current.issue();
    const next = await adjustPlanAction({
      ...input,
      legs: legs.map(({ role, side, ticker }) => ({ role, side, ticker })),
      lots,
    });
    if (!sequencer.current.isCurrent(requestId)) return;
    setPending(false);
    setPreviewPricing(null);
    if (next.status === "ok") {
      setCurrent(next);
    } else {
      setError(next.error);
    }
  }

  function preview(legs: PlanDiffLeg[], lots: number) {
    setPreviewPricing(null);
    startTransition(() => {
      void previewPlan(current.preview, legs, lots).then((pricing) => {
        if (pricing) setPreviewPricing(pricing.payoff);
      });
    });
  }

  function onStrikeStep(leg: PlanDiffLeg, direction: 1 | -1) {
    const right = rightOf(current, leg.ticker);
    if (!right || !expiry) return;
    const strikes = selectableStrikes(chain, right, expiry);
    const nextTicker = stepStrike(strikes, leg.ticker, direction);
    if (!nextTicker || nextTicker === leg.ticker) return;
    applyLegChange(leg, nextTicker);
  }

  function legsWithChange(leg: PlanDiffLeg, nextTicker: Ticker): PlanDiffLeg[] {
    return legsOf(current.plan).map((candidate) =>
      candidate.role === leg.role && candidate.side === leg.side
        ? { ...candidate, ticker: nextTicker }
        : candidate,
    );
  }

  function applyLegChange(leg: PlanDiffLeg, nextTicker: Ticker) {
    const nextLegs = legsWithChange(leg, nextTicker);
    preview(nextLegs, current.plan.lots);
    void commit(nextLegs, current.plan.lots);
  }

  // The chart handle's own continuous redraw while dragging (ticket #380): client preview only,
  // never a server round trip — `onHandleCommit` (release) is what calls `applyLegChange`.
  function previewLegChange(leg: PlanDiffLeg, nextTicker: Ticker) {
    if (nextTicker === leg.ticker) return;
    preview(legsWithChange(leg, nextTicker), current.plan.lots);
  }

  function onLotsStep(direction: 1 | -1) {
    const nextLots = stepLots(current.plan.lots, direction);
    if (nextLots === current.plan.lots) return;
    const legs = legsOf(current.plan);
    preview(legs, nextLots);
    void commit(legs, nextLots);
  }

  function onExpirySelect(nextExpiry: SessionDate) {
    if (nextExpiry === expiry) return;
    const legs = legsOf(current.plan);
    const remapped = legs.map((leg) => {
      const right = rightOf(current, leg.ticker);
      if (!right) return leg;
      const series = current.seriesByTicker[leg.ticker];
      if (!series) return leg;
      const nextTicker = remapToExpiry(chain, right, series.strike, nextExpiry);
      return nextTicker ? { ...leg, ticker: nextTicker } : leg;
    });
    preview(remapped, current.plan.lots);
    void commit(remapped, current.plan.lots);
  }

  function onReset() {
    setCurrent(original);
    setPreviewPricing(null);
    setError(null);
  }

  const plan = current.plan;
  const legs = legsOf(plan);

  // One payoff-chart handle per option leg (ticket #380): the chart only ever sees numbers and
  // ticks, every ticker lookup stays here. `onPreview`/`onCommit` resolve the chart's own
  // snapped strike (already restricted to traded candidates, `tradedStrikes`) back to its
  // ticker through `tickerAtStrike`, then hand off to `previewLegChange`/`applyLegChange` —
  // the exact functions the ← → buttons already call, never a second implementation.
  const strikeHandles: PayoffStrikeHandle[] = legs.flatMap((leg) => {
    if (leg.role === "stock" || !expiry) return [];
    const right = rightOf(current, leg.ticker);
    const series = current.seriesByTicker[leg.ticker];
    if (!right || !series) return [];
    const tradedStrikes = selectableStrikes(chain, right, expiry);
    const allStrikes = allStrikesFor(chain, right, expiry);
    if (allStrikes.length === 0) return [];
    const values = allStrikes.map((entry) => Number(entry.strike));
    return [
      {
        key: `${leg.role}-${leg.side}`,
        ariaLabel: t.adjust.strikeLabel(sideLabel[leg.side], t.adjust.roleNames[leg.role]),
        valueText: formatPriceBRL(series.strike),
        value: Number(series.strike),
        min: values[0] ?? Number(series.strike),
        max: values.at(-1) ?? Number(series.strike),
        ticks: allStrikes.map((entry) => ({ value: Number(entry.strike), traded: entry.traded })),
        onPreview: (nextValue) => {
          const nextTicker = tickerAtStrike(tradedStrikes, nextValue);
          if (nextTicker) previewLegChange(leg, nextTicker);
        },
        onCommit: (nextValue) => {
          const nextTicker = tickerAtStrike(tradedStrikes, nextValue);
          if (nextTicker && nextTicker !== leg.ticker) applyLegChange(leg, nextTicker);
        },
        onStep: (direction) => {
          onStrikeStep(leg, direction);
        },
      },
    ];
  });

  return (
    <div className="flex flex-col gap-6">
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
                  <InstrumentCell leg={leg} series={current.seriesByTicker[leg.ticker]} />
                </TableCell>
                <TableCell
                  data-label={t.screen.orders.quantity}
                  className="text-right font-mono tabular-nums"
                >
                  {formatQuantity(leg.quantity)}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium">{t.adjust.title}</h2>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {t.adjust.lotsLabel}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.adjust.decreaseLots}
            onClick={() => {
              onLotsStep(-1);
            }}
            disabled={pending}
          >
            −
          </Button>
          <span className="w-8 text-center font-mono tabular-nums">{plan.lots}</span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.adjust.increaseLots}
            onClick={() => {
              onLotsStep(1);
            }}
            disabled={pending}
          >
            +
          </Button>
        </div>

        {current.expiryOptions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
              {t.adjust.expiryLabel}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {current.expiryOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={option === expiry ? "secondary" : "outline"}
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    onExpirySelect(option);
                  }}
                >
                  {formatSessionDate(option)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Mandatory phone/keyboard alternative to the chart's own strike handles below (ticket
            #380), not a fallback: one per-leg row of ← → buttons, calling the exact same
            `onStrikeStep` the chart handle's own arrow keys call. */}
        <div className="flex flex-col gap-3">
          {legs
            .filter((leg) => leg.role !== "stock")
            .map((leg) => {
              const right = rightOf(current, leg.ticker);
              if (!right || !expiry) return null;
              const strikes = selectableStrikes(chain, right, expiry);
              const index = indexOfTicker(strikes, leg.ticker);
              const series = current.seriesByTicker[leg.ticker];
              const label = t.adjust.strikeLabel(sideLabel[leg.side], t.adjust.roleNames[leg.role]);
              return (
                <div key={`${leg.role}-${leg.side}`} className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
                    {label}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={t.adjust.decreaseStrike}
                      disabled={pending || index <= 0}
                      onClick={() => {
                        onStrikeStep(leg, -1);
                      }}
                    >
                      ←
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={t.adjust.increaseStrike}
                      disabled={pending || index === -1 || index >= strikes.length - 1}
                      onClick={() => {
                        onStrikeStep(leg, 1);
                      }}
                    >
                      →
                    </Button>
                    <span className="w-20 text-right font-mono text-[13px] tabular-nums">
                      {series ? formatPriceBRL(series.strike) : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>

        {pending && <Badge variant="secondary">{t.adjust.adjusting}</Badge>}
        {previewPricing && !pending && <Badge variant="outline">{t.adjust.preview}</Badge>}
        {error && <ErrorNotice>{t.adjust.errors.adjust_failed}</ErrorNotice>}
      </section>

      <PayoffChart
        points={previewPricing ?? plan.payoff}
        pointsNow={plan.payoffNow}
        spot={plan.spot}
        breakEvens={plan.breakEvens}
        maxGain={plan.maxGainCentavos}
        maxLoss={plan.maxLossCentavos}
        spotLabel={formatPriceBRL(plan.spot)}
        framed
        handles={strikeHandles}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium">{t.adjust.whatChanged.title}</h2>
        {changes.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">{t.adjust.whatChanged.none}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {changes.map((change, index) => (
              <li key={index}>
                {change.kind === "lots"
                  ? t.adjust.whatChanged.lots(change.from, change.to)
                  : t.adjust.whatChanged.leg(
                      sideLabel[change.side],
                      t.adjust.roleNames[change.role],
                      change.from,
                      change.to,
                    )}
              </li>
            ))}
          </ul>
        )}
        {changes.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={pending}>
            {t.adjust.reset}
          </Button>
        )}
      </section>

      <SavePlanButton
        input={input}
        fingerprint={current.fingerprint}
        adjustment={
          changes.length > 0
            ? {
                legs: legs.map(({ role, side, ticker }) => ({ role, side, ticker })),
                lots: plan.lots,
              }
            : undefined
        }
      />
    </div>
  );
}
