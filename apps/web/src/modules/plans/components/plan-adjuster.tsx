"use client";

import { useRef, useState } from "react";
import type { SessionDate, Ticker } from "@fetha/contracts";
import type { OperationPricing } from "@fetha/engine";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
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
import { exitText } from "@/modules/recipes/client";
import { PayoffChart, RiskNotice, type PayoffStrikeHandle } from "@/modules/portfolio/client";

import {
  adjustPlanAction,
  type BuildPlanActionInput,
  type BuildPlanOutcome,
  type PlanActionError,
} from "../actions";
import type { PlanChainEntry } from "../chain-view";
import {
  allStrikesFor,
  boundedStrikes,
  rankBoundsFor,
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
import { optionLegsOf } from "../template-legs";
import { InstrumentCell, legTotalCentavos, riskUsedText, StatBlock } from "./plan-parts";
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

// The adjustment round trip never sends role or side (ticket #380, blocking item 2/3): the
// server rebuilds every leg from the structure's own template, keyed by this exact position
// among the non-stock legs — a stock leg has no strike a user could have moved.
function toAdjustmentLegs(legs: readonly PlanDiffLeg[]): { ticker: Ticker }[] {
  return legs.filter((leg) => leg.role !== "stock").map((leg) => ({ ticker: leg.ticker }));
}

function legsWithChangeAt(
  legs: readonly PlanDiffLeg[],
  index: number,
  nextTicker: Ticker,
): PlanDiffLeg[] {
  return legs.map((leg, i) => (i === index ? { ...leg, ticker: nextTicker } : leg));
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
// overwrite a newer one. Every leg is identified by its own position in `plan.legs`, which
// always mirrors `outcome.structure.legs`' own template order (round 4 review, blocking item 3):
// never by role+side, which collides for two legs sharing both (a butterfly's own wings).
export function PlanAdjuster({
  outcome,
  riskLimitCentavos,
  input,
}: {
  outcome: Ok;
  riskLimitCentavos: number;
  input: BuildPlanActionInput;
}) {
  const [original] = useState<Ok>(outcome);
  const [current, setCurrent] = useState<Ok>(outcome);
  const [previewPricing, setPreviewPricing] = useState<OperationPricing | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PlanActionError | null>(null);
  const [expiryRemapFailed, setExpiryRemapFailed] = useState(false);
  const commitSequencer = useRef(new LatestRequestWins());
  const previewSequencer = useRef(new LatestRequestWins());

  const chain = current.chain;
  const expiry = expiryOf(current);
  const legs = legsOf(current.plan);
  const changes = diffPlans(snapshotOf(original.plan), snapshotOf(current.plan));

  async function commit(nextLegs: PlanDiffLeg[], lots: number) {
    setPending(true);
    setError(null);
    setExpiryRemapFailed(false);
    const requestId = commitSequencer.current.issue();
    try {
      const next = await adjustPlanAction({
        ...input,
        legs: toAdjustmentLegs(nextLegs),
        lots,
      });
      if (!commitSequencer.current.isCurrent(requestId)) return;
      setPreviewPricing(null);
      if (next.status === "ok") {
        setCurrent(next);
      } else {
        setError(next.error);
      }
    } finally {
      if (commitSequencer.current.isCurrent(requestId)) setPending(false);
    }
  }

  function preview(nextLegs: PlanDiffLeg[], lots: number) {
    setPreviewPricing(null);
    const requestId = previewSequencer.current.issue();
    void previewPlan(current.preview, nextLegs, lots).then((pricing) => {
      if (!previewSequencer.current.isCurrent(requestId)) return;
      if (pricing) setPreviewPricing(pricing);
    });
  }

  function onStrikeStep(index: number, candidates: readonly PlanChainEntry[], direction: 1 | -1) {
    if (pending) return;
    const leg = legs[index];
    if (!leg) return;
    const nextTicker = stepStrike(candidates, leg.ticker, direction);
    if (!nextTicker || nextTicker === leg.ticker) return;
    applyLegChange(index, nextTicker);
  }

  function applyLegChange(index: number, nextTicker: Ticker) {
    const nextLegs = legsWithChangeAt(legs, index, nextTicker);
    preview(nextLegs, current.plan.lots);
    void commit(nextLegs, current.plan.lots);
  }

  // The chart handle's own continuous redraw while dragging (ticket #380): client preview only,
  // never a server round trip — `onHandleCommit` (release) is what calls `applyLegChange`.
  function previewLegChange(index: number, nextTicker: Ticker) {
    const leg = legs[index];
    if (!leg || nextTicker === leg.ticker) return;
    preview(legsWithChangeAt(legs, index, nextTicker), current.plan.lots);
  }

  function onLotsStep(direction: 1 | -1) {
    if (pending) return;
    const nextLots = stepLots(current.plan.lots, direction);
    if (nextLots === current.plan.lots) return;
    preview(legs, nextLots);
    void commit(legs, nextLots);
  }

  // All-or-nothing (round 4 review item 8): if even one leg cannot remap to the new expiry, the
  // whole switch is refused and the plan stays on its current expiry, rather than saving a plan
  // split across two expiries.
  function onExpirySelect(nextExpiry: SessionDate) {
    if (pending || nextExpiry === expiry) return;
    setExpiryRemapFailed(false);
    const remapped: PlanDiffLeg[] = [];
    for (const leg of legs) {
      if (leg.role === "stock") {
        remapped.push(leg);
        continue;
      }
      const right = rightOf(current, leg.ticker);
      const series = current.seriesByTicker[leg.ticker];
      const nextTicker = right && series ? remapToExpiry(chain, right, series.strike, nextExpiry) : null;
      if (!nextTicker) {
        setExpiryRemapFailed(true);
        return;
      }
      remapped.push({ ...leg, ticker: nextTicker });
    }
    preview(remapped, current.plan.lots);
    void commit(remapped, current.plan.lots);
  }

  function onReset() {
    setCurrent(original);
    setPreviewPricing(null);
    setError(null);
  }

  const plan = current.plan;

  // One rank bound per option leg (round 4 review item 4): a handle or a ← → button may never
  // cross, or land on, the current strike of the rank immediately below or above this one.
  const optionTemplateLegs = optionLegsOf(current.structure);
  const optionFullIndices = legs.reduce<number[]>((acc, leg, index) => {
    if (leg.role !== "stock") acc.push(index);
    return acc;
  }, []);
  const rankBounds = rankBoundsFor(optionTemplateLegs, (optionIndex) => {
    const fullIndex = optionFullIndices[optionIndex];
    const leg = fullIndex === undefined ? undefined : legs[fullIndex];
    const series = leg ? current.seriesByTicker[leg.ticker] : undefined;
    return series ? Number(series.strike) : null;
  });

  // One payoff-chart handle per option leg (ticket #380): the chart only ever sees numbers and
  // ticks, every ticker lookup stays here. `onPreview`/`onCommit` resolve the chart's own
  // snapped strike (already restricted to traded, in-bound candidates) back to its ticker
  // through `tickerAtStrike`, then hand off to `previewLegChange`/`applyLegChange` — the exact
  // functions the ← → buttons already call, never a second implementation.
  const strikeHandles: PayoffStrikeHandle[] = optionFullIndices.flatMap((fullIndex, optionIndex) => {
    const leg = legs[fullIndex];
    if (!leg || !expiry) return [];
    const right = rightOf(current, leg.ticker);
    const series = current.seriesByTicker[leg.ticker];
    if (!right || !series) return [];
    const bound = rankBounds[optionIndex] ?? { lower: null, upper: null };
    const tradedStrikes = boundedStrikes(selectableStrikes(chain, right, expiry), bound.lower, bound.upper);
    const allStrikes = allStrikesFor(chain, right, expiry);
    if (allStrikes.length === 0) return [];
    const values = allStrikes.map((entry) => Number(entry.strike));
    return [
      {
        key: `leg-${String(fullIndex)}`,
        ariaLabel: t.adjust.strikeLabel(sideLabel[leg.side], t.adjust.roleNames[leg.role]),
        valueText: formatPriceBRL(series.strike),
        value: Number(series.strike),
        min: values[0] ?? Number(series.strike),
        max: values.at(-1) ?? Number(series.strike),
        // Dimmed when either untraded or outside this leg's own rank bound: both mean the same
        // thing to a handle, "cannot land here" (round 4 review item 4).
        ticks: allStrikes.map((entry) => ({
          value: Number(entry.strike),
          traded:
            entry.traded &&
            (bound.lower === null || Number(entry.strike) > bound.lower) &&
            (bound.upper === null || Number(entry.strike) < bound.upper),
        })),
        onPreview: (nextValue) => {
          const nextTicker = tickerAtStrike(tradedStrikes, nextValue);
          if (nextTicker) previewLegChange(fullIndex, nextTicker);
        },
        onCommit: (nextValue) => {
          const nextTicker = tickerAtStrike(tradedStrikes, nextValue);
          if (nextTicker && nextTicker !== leg.ticker) applyLegChange(fullIndex, nextTicker);
        },
        onStep: (direction) => {
          onStrikeStep(fullIndex, tradedStrikes, direction);
        },
      },
    ];
  });

  const previewSource = previewPricing;

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
          value={formatBRL(plan.netPremiumCentavos)}
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
            {plan.legs.map(({ leg, limitPrice }, index) => (
              <TableRow key={index}>
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
          {optionFullIndices.map((fullIndex, optionIndex) => {
            const leg = legs[fullIndex];
            if (!leg) return null;
            const right = rightOf(current, leg.ticker);
            if (!right || !expiry) return null;
            const bound = rankBounds[optionIndex] ?? { lower: null, upper: null };
            const strikes = boundedStrikes(selectableStrikes(chain, right, expiry), bound.lower, bound.upper);
            const index = strikes.findIndex((entry) => entry.ticker === leg.ticker);
            const series = current.seriesByTicker[leg.ticker];
            const label = t.adjust.strikeLabel(sideLabel[leg.side], t.adjust.roleNames[leg.role]);
            return (
              <div key={`leg-${String(fullIndex)}`} className="flex flex-col gap-1.5">
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
                      onStrikeStep(fullIndex, strikes, -1);
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
                      onStrikeStep(fullIndex, strikes, 1);
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
        {previewSource && !pending && <Badge variant="outline">{t.adjust.preview}</Badge>}
        {error && <ErrorNotice>{t.screen.errors[error]}</ErrorNotice>}
        {expiryRemapFailed && <ErrorNotice>{t.adjust.errors.expiry_remap_failed}</ErrorNotice>}
      </section>

      <PayoffChart
        points={previewSource?.payoff ?? plan.payoff}
        pointsNow={previewSource ? previewSource.payoffNow ?? null : plan.payoffNow}
        spot={previewSource?.spot ?? plan.spot}
        breakEvens={previewSource?.breakEvens ?? plan.breakEvens}
        maxGain={previewSource?.maxGain ?? plan.maxGainCentavos}
        maxLoss={previewSource?.maxLoss ?? plan.maxLossCentavos}
        spotLabel={formatPriceBRL(previewSource?.spot ?? plan.spot)}
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
        adjustment={changes.length > 0 ? { legs: toAdjustmentLegs(legs), lots: plan.lots } : undefined}
      />
    </div>
  );
}
