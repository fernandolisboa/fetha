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
  type PlanLegSeries,
} from "../actions";
import type { PlanChainEntry } from "../chain-view";
import {
  allStrikesForRank,
  boundedStrikes,
  commonSelectableStrikes,
  rankBoundsFor,
  ranksOf,
  remapToExpiry,
  selectableStrikes,
  stepStrikeValue,
  tickerAtStrike,
  type RankGroup,
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

// The adjustment round trip never sends role or side (ticket #380): the server rebuilds every
// leg from the structure's own template, keyed by this exact position among the non-stock legs
// — a stock leg has no strike a user could have moved.
function toAdjustmentLegs(legs: readonly PlanDiffLeg[]): { ticker: Ticker }[] {
  return legs.filter((leg) => leg.role !== "stock").map((leg) => ({ ticker: leg.ticker }));
}

// Applies every leg's own next ticker at once (ticket #380): a strike rank shared by more than
// one right (a straddle's call and put) always moves together, never one leg at a time, so an
// edit is always expressed as a full map of full-array index to its next ticker.
function legsWithChanges(
  legs: readonly PlanDiffLeg[],
  updates: ReadonlyMap<number, Ticker>,
): PlanDiffLeg[] {
  return legs.map((leg, index) => {
    const nextTicker = updates.get(index);
    return nextTicker ? { ...leg, ticker: nextTicker } : leg;
  });
}

const sideLabel = { buy: t.screen.orders.buy, sell: t.screen.orders.sell } as const;

// Drag-to-adjust (ticket #380): wraps the read-only plan screen's own numbers, orders, chart and
// rules with editable strike handles drawn directly on the payoff chart's own price axis
// (`PayoffStrikeHandle`, `@/modules/portfolio/client`), the strike rank's own ← → buttons (the
// phone and screen-reader alternative, not a fallback relegated to a second control — the
// handle's own arrow keys call the exact same `onRankStep`), a lot stepper and expiry chips. A
// strike rank — not a single leg — is the unit of a strike edit: legs sharing a rank (a
// straddle's call and put, both at one strike) always move together, since the server requires
// them on the same strike. A client-side preview (`previewPlan`, the engine's own pure
// `priceOperation`) redraws the chart continuously while dragging (`previewRankChange`, never
// hitting the server); `adjustPlanAction` then prices the exact same edit on the server once, on
// release, a lot +/- press or an expiry chip — never on every pixel of a drag — and only that
// reply ever becomes the plan's official numbers (`current`) — guarded by `LatestRequestWins` so
// a slow reply from an earlier edit can never overwrite a newer one. Every leg is identified by
// its own position in `plan.legs`, which always mirrors `outcome.structure.legs`' own template
// order: never by role+side, which collides for two legs sharing both (a butterfly's own wings).
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
  const [adjustFailed, setAdjustFailed] = useState(false);
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
    setAdjustFailed(false);
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
        // `adjustPlanAction` never re-ships the market view (it cannot change within one
        // session); the client keeps the copy it already has.
        setCurrent({
          ...next,
          preview: { ...next.preview, marketView: current.preview.marketView },
        });
      } else {
        setError(next.error);
      }
    } catch {
      if (commitSequencer.current.isCurrent(requestId)) {
        setPreviewPricing(null);
        setAdjustFailed(true);
      }
    } finally {
      if (commitSequencer.current.isCurrent(requestId)) setPending(false);
    }
  }

  function clearPreview() {
    previewSequencer.current.issue();
    setPreviewPricing(null);
  }

  function preview(nextLegs: PlanDiffLeg[], lots: number) {
    setPreviewPricing(null);
    const requestId = previewSequencer.current.issue();
    void previewPlan(
      current.preview,
      current.structure,
      current.plan.underlying,
      nextLegs,
      lots,
    ).then((pricing) => {
      if (!previewSequencer.current.isCurrent(requestId)) return;
      if (pricing) setPreviewPricing(pricing);
    });
  }

  // Resolves every leg of a rank to its own ticker at a shared next strike value, one per right
  // present at that rank (a straddle's call and put move together) — null if any of them has no
  // listed series there, so a rank edit is always all-or-nothing, never partial.
  function tickersForRank(rank: RankGroup, strikeValue: number): Map<number, Ticker> | null {
    if (!expiry) return null;
    const updates = new Map<number, Ticker>();
    for (const templateIndex of rank.legIndices) {
      const fullIndex = optionFullIndices[templateIndex];
      const right = optionTemplateLegs[templateIndex]?.role;
      if (fullIndex === undefined || !right) return null;
      const ticker = tickerAtStrike(selectableStrikes(chain, right, expiry), strikeValue);
      if (!ticker) return null;
      updates.set(fullIndex, ticker);
    }
    return updates;
  }

  function seriesOfRank(rank: RankGroup): PlanLegSeries | null {
    const templateIndex = rank.legIndices[0];
    const fullIndex = templateIndex === undefined ? undefined : optionFullIndices[templateIndex];
    const leg = fullIndex === undefined ? undefined : legs[fullIndex];
    return leg ? (current.seriesByTicker[leg.ticker] ?? null) : null;
  }

  function currentStrikeOfRank(rank: RankGroup): number | null {
    const series = seriesOfRank(rank);
    return series ? Number(series.strike) : null;
  }

  function applyRankChange(rank: RankGroup, strikeValue: number) {
    const updates = tickersForRank(rank, strikeValue);
    if (!updates) return;
    const nextLegs = legsWithChanges(legs, updates);
    preview(nextLegs, current.plan.lots);
    void commit(nextLegs, current.plan.lots);
  }

  // The chart handle's own continuous redraw while dragging (ticket #380): client preview only,
  // never a server round trip — `onHandleCommit` (release) is what calls `applyRankChange`.
  function previewRankChange(rank: RankGroup, strikeValue: number) {
    const updates = tickersForRank(rank, strikeValue);
    if (!updates) return;
    preview(legsWithChanges(legs, updates), current.plan.lots);
  }

  function onRankStep(rank: RankGroup, candidates: readonly PlanChainEntry[], direction: 1 | -1) {
    if (pending) return;
    const currentValue = currentStrikeOfRank(rank);
    if (currentValue === null) return;
    const nextValue = stepStrikeValue(candidates, currentValue, direction);
    if (nextValue === null || nextValue === currentValue) return;
    applyRankChange(rank, nextValue);
  }

  function onLotsStep(direction: 1 | -1) {
    if (pending) return;
    const nextLots = stepLots(current.plan.lots, direction);
    if (nextLots === current.plan.lots) return;
    preview(legs, nextLots);
    void commit(legs, nextLots);
  }

  // All-or-nothing: if even one leg cannot remap to the new expiry, the whole switch is refused
  // and the plan stays on its current expiry, rather than saving a plan split across two
  // expiries.
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
      const nextTicker =
        right && series ? remapToExpiry(chain, right, series.strike, nextExpiry) : null;
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

  const optionTemplateLegs = optionLegsOf(current.structure);
  const optionFullIndices = legs.reduce<number[]>((acc, leg, index) => {
    if (leg.role !== "stock") acc.push(index);
    return acc;
  }, []);
  const ranks = ranksOf(optionTemplateLegs);

  // One strike bound per rank (not per leg): a handle or a ← → button may never cross, or land
  // on, the current strike of the rank immediately below or above this one.
  const rankBounds = rankBoundsFor(ranks, (rankIndex) => {
    const rank = ranks[rankIndex];
    return rank ? currentStrikeOfRank(rank) : null;
  });

  // One payoff-chart handle per strike rank (ticket #380), never per leg: a straddle's call and
  // put, sharing a rank, move together under one handle. The chart only ever sees numbers and
  // ticks, every ticker lookup stays here. `onPreview`/`onCommit` resolve the chart's own
  // snapped strike (already restricted to traded, in-bound candidates for every right at this
  // rank) back to every leg's own ticker through `tickersForRank`, then hand off to
  // `previewRankChange`/`applyRankChange` — the exact functions the ← → buttons already call,
  // never a second implementation.
  const strikeHandles: PayoffStrikeHandle[] = ranks.flatMap((rank, rankIndex) => {
    if (!expiry) return [];
    const rights = [
      ...new Set(
        rank.legIndices
          .map((templateIndex) => optionTemplateLegs[templateIndex]?.role)
          .filter((right): right is "call" | "put" => right !== undefined),
      ),
    ];
    if (rights.length === 0) return [];
    const series = seriesOfRank(rank);
    if (!series) return [];
    const currentValue = Number(series.strike);
    const bound = rankBounds[rankIndex] ?? { lower: null, upper: null };
    const tradedStrikes = boundedStrikes(
      commonSelectableStrikes(chain, rights, expiry),
      bound.lower,
      bound.upper,
    );
    const allValues = allStrikesForRank(chain, rights, expiry);
    if (allValues.length === 0) return [];
    const label = rank.legIndices
      .flatMap((templateIndex) => {
        const fullIndex = optionFullIndices[templateIndex];
        const leg = fullIndex === undefined ? undefined : legs[fullIndex];
        return leg ? [t.adjust.strikeLabel(sideLabel[leg.side], t.adjust.roleNames[leg.role])] : [];
      })
      .join(" / ");
    return [
      {
        key: `rank-${String(rank.strikeRank)}`,
        ariaLabel: label,
        valueText: formatPriceBRL(series.strike),
        value: currentValue,
        min: allValues[0] ?? currentValue,
        max: allValues.at(-1) ?? currentValue,
        // Dimmed when either untraded for one of the rank's own rights or outside this rank's
        // own bound: both mean the same thing to a handle, "cannot land here".
        ticks: allValues.map((value) => ({
          value,
          traded: tradedStrikes.some((entry) => Number(entry.strike) === value),
        })),
        onPreview: (nextValue) => {
          if (nextValue === currentValue) {
            clearPreview();
            return;
          }
          previewRankChange(rank, nextValue);
        },
        onCommit: (nextValue) => {
          if (nextValue === currentValue) {
            clearPreview();
            return;
          }
          applyRankChange(rank, nextValue);
        },
        onStep: (direction) => {
          onRankStep(rank, tradedStrikes, direction);
        },
        onAbort: clearPreview,
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
        <StatBlock label={t.screen.numbers.cashToday} value={formatBRL(plan.netPremiumCentavos)} />
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
            #380), not a fallback: one row of ← → buttons per strike rank, calling the exact
            same `onRankStep` the chart handle's own arrow keys call — a straddle's call and put
            share one row, since they always move together. */}
        <div className="flex flex-col gap-3">
          {ranks.map((rank, rankIndex) => {
            const rights = [
              ...new Set(
                rank.legIndices
                  .map((templateIndex) => optionTemplateLegs[templateIndex]?.role)
                  .filter((right): right is "call" | "put" => right !== undefined),
              ),
            ];
            if (!expiry || rights.length === 0) return null;
            const series = seriesOfRank(rank);
            if (!series) return null;
            const bound = rankBounds[rankIndex] ?? { lower: null, upper: null };
            const strikes = boundedStrikes(
              commonSelectableStrikes(chain, rights, expiry),
              bound.lower,
              bound.upper,
            );
            const index = strikes.findIndex(
              (entry) => Number(entry.strike) === Number(series.strike),
            );
            const label = rank.legIndices
              .flatMap((templateIndex) => {
                const fullIndex = optionFullIndices[templateIndex];
                const leg = fullIndex === undefined ? undefined : legs[fullIndex];
                return leg
                  ? [t.adjust.strikeLabel(sideLabel[leg.side], t.adjust.roleNames[leg.role])]
                  : [];
              })
              .join(" / ");
            return (
              <div key={`rank-${String(rank.strikeRank)}`} className="flex flex-col gap-1.5">
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
                      onRankStep(rank, strikes, -1);
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
                      onRankStep(rank, strikes, 1);
                    }}
                  >
                    →
                  </Button>
                  <span className="w-20 text-right font-mono text-[13px] tabular-nums">
                    {formatPriceBRL(series.strike)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {pending && <Badge variant="secondary">{t.adjust.adjusting}</Badge>}
        {previewSource && !pending && <Badge variant="outline">{t.adjust.preview}</Badge>}
        {error && <ErrorNotice>{t.screen.errors[error]}</ErrorNotice>}
        {adjustFailed && <ErrorNotice>{t.adjust.errors.adjust_failed}</ErrorNotice>}
        {expiryRemapFailed && <ErrorNotice>{t.adjust.errors.expiry_remap_failed}</ErrorNotice>}
      </section>

      <PayoffChart
        points={previewSource?.payoff ?? plan.payoff}
        pointsNow={previewSource ? (previewSource.payoffNow ?? null) : plan.payoffNow}
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
        adjustment={
          changes.length > 0 ? { legs: toAdjustmentLegs(legs), lots: plan.lots } : undefined
        }
      />
    </div>
  );
}
