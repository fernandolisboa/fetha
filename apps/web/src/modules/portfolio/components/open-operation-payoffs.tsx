import type { SessionDate } from "@fetha/contracts";
import type { OperationPricing } from "@fetha/engine";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { Panel } from "@/modules/shell";

import { PayoffChart } from "../builder/payoff-chart";
import { StatBlock } from "../builder/stat-blocks";
import type { OperationRow } from "../portfolio-service";
import { t } from "../strings";

const labels = t.dashboard.openPayoffs;

export interface OpenOperationPayoffs {
  charted: { id: string; underlying: string; openedAt: SessionDate; pricing: OperationPricing }[];
  uncharted: string[];
}

export function openOperationPayoffs(operations: readonly OperationRow[]): OpenOperationPayoffs {
  const open = operations.filter(
    ({ operation, pendingSettlement }) => operation.status === "open" && !pendingSettlement,
  );
  return {
    charted: open.flatMap(({ operation, entryPayoff }) =>
      entryPayoff
        ? [
            {
              id: operation.id,
              underlying: operation.underlying,
              openedAt: operation.openedAt,
              pricing: entryPayoff,
            },
          ]
        : [],
    ),
    uncharted: open
      .filter(({ entryPayoff }) => !entryPayoff)
      .map(({ operation }) => operation.underlying),
  };
}

function moneyOrUnbounded(value: OperationPricing["maxGain"]): string {
  return value === "unbounded" ? t.builder.statBlocks.unbounded : formatBRL(value);
}

export function OpenOperationPayoffsPanel({ operations }: { operations: readonly OperationRow[] }) {
  const { charted, uncharted } = openOperationPayoffs(operations);
  if (charted.length === 0 && uncharted.length === 0) return null;
  return (
    <Panel title={labels.title} subtitle={labels.subtitle}>
      <div className="@container" data-testid="open-operation-payoffs">
        <div className="grid grid-cols-1 gap-[14px] @min-[56rem]:grid-cols-2 @min-[96rem]:grid-cols-3">
          {charted.map(({ id, underlying, openedAt, pricing }) => (
            <article
              key={id}
              aria-label={labels.cardLabel(
                underlying,
                formatDate(sessionDateToDisplayDate(openedAt)),
              )}
              className="flex min-w-0 flex-col gap-3 rounded-[var(--radius)] border border-[var(--line)] p-3"
            >
              <header className="flex items-baseline justify-between gap-2">
                <span className="font-mono uppercase">{underlying}</span>
                <span className="text-muted-foreground font-mono text-[12px] tabular-nums">
                  {labels.opened(formatDate(sessionDateToDisplayDate(openedAt)))}
                </span>
              </header>
              <div className="grid grid-cols-3 gap-3">
                <StatBlock
                  label={t.builder.statBlocks.maxGain}
                  value={moneyOrUnbounded(pricing.maxGain)}
                />
                <StatBlock
                  label={t.builder.statBlocks.maxLoss}
                  value={moneyOrUnbounded(pricing.maxLoss)}
                />
                <StatBlock
                  label={t.builder.statBlocks.breakEvens}
                  value={
                    pricing.breakEvens.length > 0
                      ? pricing.breakEvens.map((value) => formatDecimal(value)).join(" / ")
                      : "—"
                  }
                />
              </div>
              <PayoffChart
                points={pricing.payoff}
                spot={pricing.spot}
                breakEvens={pricing.breakEvens}
                maxGain={pricing.maxGain}
                maxLoss={pricing.maxLoss}
                spotLabel={labels.spot(formatPriceBRL(pricing.spot))}
                framed
              />
            </article>
          ))}
        </div>
        {uncharted.length > 0 && (
          <p className="text-muted-foreground mt-3 text-[12px]">
            <span className="font-mono uppercase">{uncharted.join(", ")}</span>: {labels.uncharted}
          </p>
        )}
      </div>
    </Panel>
  );
}
