import type { ReactNode } from "react";
import type { Centavos, DecimalString, SessionDate } from "@fetha/contracts";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { Panel } from "@/modules/shell";

import { RiskNotice } from "../builder/risk-notice";
import { StatBlock } from "../builder/stat-blocks";
import type { PortfolioReadModel, PositionRow } from "../portfolio-service";
import { t } from "../strings";

import { FillsPanel, type FillRow } from "./fills-panel";
import { OpenOperationPayoffsPanel } from "./open-operation-payoffs";
import { GroupExpiredButton, UngroupButton } from "./operation-buttons";
import { SettlementDialog, type SettlementLegView } from "./settlement-dialog";

const labels = t.dashboard;

// Stacked above the tables on a narrow screen, the stats sit side by side in a grid, where the
// divider between consecutive blocks would cut across a row.
const SUMMARY_STAT = "@max-[64rem]:border-t-0 @max-[64rem]:pt-0";
const SUMMARY_VALUE = "@max-[40rem]:text-[15px]";

function session(date: SessionDate): string {
  return formatDate(sessionDateToDisplayDate(date));
}

function signedMoney(value: Centavos | null): string {
  if (value === null) return "—";
  return value > 0 ? `+ ${formatBRL(value)}` : formatBRL(value);
}

function tone(value: number | null): string | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? "var(--up)" : "var(--down)";
}

export function corporateActionNotice(skipped: boolean | null | undefined): string | null {
  return skipped ? labels.operations.corporateActionNotNormalized : null;
}

function instrumentType(row: PositionRow): string {
  if (row.holding.assetClass === "stock") return labels.positions.stock;
  return row.series ? labels.positions[row.series.right] : labels.positions.option;
}

function PriceCell({ row }: { row: PositionRow }) {
  const valuation = row.valuation;
  if (!valuation?.price) {
    return <span className="text-muted-foreground">{labels.positions.noPrice}</span>;
  }
  return (
    <span className="inline-flex flex-col items-end">
      <span>{formatDecimal(valuation.price)}</span>
      {valuation.stale && (
        <span className="text-[11px]" style={{ color: "var(--warning)" }}>
          {session(valuation.stale.session)}
        </span>
      )}
      {row.fairValue && (
        <span className="text-muted-foreground text-[11px]">
          {labels.positions.fairValue} {formatDecimal(row.fairValue)}
        </span>
      )}
    </span>
  );
}

function PositionsTable({ rows }: { rows: PositionRow[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{labels.positions.empty}</p>;
  }
  return (
    <Table stacked>
      <TableHeader>
        <TableRow>
          <TableHead>{labels.positions.instrument}</TableHead>
          <TableHead>{labels.positions.type}</TableHead>
          <TableHead className="text-right">{labels.positions.quantity}</TableHead>
          <TableHead className="text-right">{labels.positions.averageCost}</TableHead>
          <TableHead className="text-right">{labels.positions.price}</TableHead>
          <TableHead className="text-right">{labels.positions.value}</TableHead>
          <TableHead className="text-right">{labels.positions.unrealizedPnl}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const quantity = row.holding.position.quantity;
          const notice = corporateActionNotice(row.corporateActionNormalizationSkipped);
          return (
            <TableRow key={`${row.holding.ticker}-${row.holding.expiry ?? ""}`}>
              <TableCell data-stack="title" className="font-mono uppercase">
                {row.holding.ticker}
                {row.holding.expiry && (
                  <span className="text-muted-foreground ml-2 text-[11px] normal-case">
                    {session(row.holding.expiry)}
                  </span>
                )}
                {notice && (
                  <span className="text-muted-foreground mt-1 block max-w-[220px] font-sans text-[11px] whitespace-normal normal-case">
                    {notice}
                  </span>
                )}
              </TableCell>
              <TableCell
                data-label={labels.positions.type}
                className="text-muted-foreground text-[12px]"
              >
                {instrumentType(row)}
              </TableCell>
              <TableCell
                data-label={labels.positions.quantity}
                className="text-right font-mono tabular-nums"
                style={{ color: quantity > 0 ? "var(--up)" : "var(--down)" }}
              >
                {formatDecimal(String(quantity) as DecimalString, 0)}
              </TableCell>
              <TableCell
                data-label={labels.positions.averageCost}
                className="text-right font-mono tabular-nums"
              >
                {formatDecimal(row.holding.position.averageCost)}
              </TableCell>
              <TableCell
                data-label={labels.positions.price}
                className="text-right font-mono tabular-nums"
              >
                <PriceCell row={row} />
              </TableCell>
              <TableCell
                data-label={labels.positions.value}
                className="text-right font-mono tabular-nums"
              >
                {row.valuation?.value === null || row.valuation === null
                  ? "—"
                  : formatBRL(row.valuation.value)}
              </TableCell>
              <TableCell
                data-label={labels.positions.unrealizedPnl}
                className="text-right font-mono tabular-nums"
                style={{ color: tone(row.valuation?.unrealizedPnl ?? null) }}
              >
                {signedMoney(row.valuation?.unrealizedPnl ?? null)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// #271 review round 1 item 5: the dialog defaults its price from the engine's own rebased fill,
// not the leg's strike. #282: an option leg shows the count it closes at
// (`closingQuantities`), the same one the ledger stores and the confirm action checks; a kept
// stock leg shows the engine's fill or its nominal quantity.
export function settlementLegs(
  pending: PortfolioReadModel["pendingSettlements"][number],
): SettlementLegView[] {
  const { proposal, closingQuantities } = pending;
  if (!proposal || !closingQuantities) return [];
  return proposal.legs.map((settlement) => {
    const fill = settlement.fills[0];
    return {
      ticker: settlement.leg.ticker,
      role: settlement.leg.role,
      side: settlement.leg.side,
      quantity:
        closingQuantities[settlement.leg.ticker] ?? fill?.quantity ?? settlement.leg.quantity,
      price: fill?.price ?? null,
      strike: (pending.strikes[settlement.leg.ticker] as DecimalString | undefined) ?? null,
      intrinsicValue: settlement.intrinsicValue,
      proposed: settlement.outcome,
      cashSettlementValue: settlement.cashSettlementValue,
    };
  });
}

function PendingSettlements({ model }: { model: PortfolioReadModel }) {
  if (model.pendingSettlements.length === 0 && model.expiredHoldings.length === 0) {
    return null;
  }
  return (
    <Panel title={labels.settlements.title} subtitle={labels.settlements.subtitle}>
      <ul className="flex flex-col divide-y" style={{ borderColor: "var(--line-soft)" }}>
        {model.pendingSettlements.map((pending) => (
          <li key={pending.operation.id} className="flex items-center justify-between gap-3 py-2">
            <span className="text-[13px]">
              <span className="font-mono uppercase">{pending.operation.underlying}</span>{" "}
              <span className="text-muted-foreground text-[12px]">
                {labels.settlements.expiredOn}{" "}
                {pending.state.expiry && session(pending.state.expiry)}
              </span>
            </span>
            {pending.proposal && pending.closingQuantities ? (
              <SettlementDialog
                operationId={pending.operation.id}
                underlying={pending.operation.underlying}
                expiry={session(pending.proposal.expiry)}
                underlyingClose={pending.proposal.underlyingClose}
                legs={settlementLegs(pending)}
              />
            ) : (
              <span className="text-[12px]" style={{ color: "var(--warning)" }}>
                {pending.proposal
                  ? labels.settlements.factorError
                  : labels.settlements.proposalError}
              </span>
            )}
          </li>
        ))}
        {model.expiredHoldings.map((expired) => (
          <li
            key={`${expired.holding.ticker}-${expired.holding.expiry ?? ""}`}
            className="flex items-center justify-between gap-3 py-2"
          >
            <span className="text-[13px]">
              <span className="font-mono uppercase">{expired.holding.ticker}</span>{" "}
              <span className="font-mono tabular-nums">
                {formatDecimal(String(expired.holding.position.quantity) as DecimalString, 0)}
              </span>{" "}
              <span className="text-muted-foreground text-[12px]">
                {labels.settlements.expiredOn}{" "}
                {expired.holding.expiry && session(expired.holding.expiry)} ·{" "}
                {labels.settlements.ungroupedHint}
              </span>
            </span>
            <GroupExpiredButton fillIds={expired.fillIds} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// Rendered by the page, which composes the decisions module into this
// table: portfolio does not import decisions (it depends on portfolio).
export type OperationDecisionSlot = (operationId: string) => ReactNode;

function OperationsTable({
  model,
  decisionSlot,
  analysisSlot,
}: {
  model: PortfolioReadModel;
  decisionSlot?: OperationDecisionSlot;
  analysisSlot?: OperationDecisionSlot;
}) {
  if (model.operations.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{labels.operations.empty}</p>;
  }
  return (
    <Table stacked>
      <TableHeader>
        <TableRow>
          <TableHead>{labels.operations.underlying}</TableHead>
          <TableHead>{labels.operations.status}</TableHead>
          <TableHead>{labels.operations.opened}</TableHead>
          <TableHead>{labels.operations.expiry}</TableHead>
          <TableHead>{labels.operations.legs}</TableHead>
          <TableHead className="text-right">{labels.operations.unrealizedPnl}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {model.operations.map(({ operation, state, valuation, pendingSettlement }) => {
          const notice = corporateActionNotice(state?.corporateActionNormalizationSkipped);
          return (
            <TableRow key={operation.id}>
              <TableCell data-stack="title" className="font-mono uppercase">
                {operation.underlying}
                {notice && (
                  <span className="text-muted-foreground mt-1 block max-w-[220px] font-sans text-[11px] whitespace-normal normal-case">
                    {notice}
                  </span>
                )}
              </TableCell>
              <TableCell data-label={labels.operations.status} className="text-[12px]">
                {pendingSettlement ? (
                  <span style={{ color: "var(--warning)" }}>
                    {labels.operations.pendingSettlement}
                  </span>
                ) : (
                  labels.operations.statuses[operation.status]
                )}
              </TableCell>
              <TableCell data-label={labels.operations.opened} className="font-mono tabular-nums">
                {session(operation.openedAt)}
              </TableCell>
              <TableCell data-label={labels.operations.expiry} className="font-mono tabular-nums">
                {operation.expiry ? session(operation.expiry) : "—"}
              </TableCell>
              <TableCell
                data-label={labels.operations.legs}
                data-stack="full"
                className="font-mono text-[12px]"
              >
                {state && state.legs.length > 0
                  ? state.legs
                      .map(
                        (leg) =>
                          `${leg.side === "buy" ? "+" : "−"}${String(leg.quantity)} ${leg.ticker}`,
                      )
                      .join(" · ")
                  : "—"}
              </TableCell>
              <TableCell
                data-label={labels.operations.unrealizedPnl}
                className="text-right font-mono tabular-nums"
                style={{ color: tone(valuation?.unrealizedPnl ?? null) }}
              >
                {signedMoney(valuation?.unrealizedPnl ?? null)}
              </TableCell>
              <TableCell data-stack="full" className="text-right">
                {operation.status === "open" && !pendingSettlement && (
                  <span className="inline-flex flex-wrap items-start justify-end gap-2">
                    {analysisSlot?.(operation.id)}
                    {decisionSlot?.(operation.id)}
                    <UngroupButton operationId={operation.id} />
                  </span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Summary({ model }: { model: PortfolioReadModel }) {
  const valuation = model.valuation?.ok ? model.valuation.value : null;
  const totals = valuation?.totals;
  return (
    <div className="order-1 flex flex-col gap-[14px] @min-[64rem]:order-2">
      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 @min-[40rem]:grid-cols-3 @min-[64rem]:flex @min-[64rem]:flex-col">
          <StatBlock
            className={SUMMARY_STAT}
            valueClassName={SUMMARY_VALUE}
            label={labels.stats.equity}
            value={formatBRL(totals?.equity ?? (model.cash as Centavos))}
          />
          <StatBlock
            className={SUMMARY_STAT}
            valueClassName={SUMMARY_VALUE}
            label={labels.stats.cash}
            value={formatBRL(model.cash as Centavos)}
            sub={labels.stats.cashSub}
          />
          <StatBlock
            className={SUMMARY_STAT}
            valueClassName={SUMMARY_VALUE}
            label={labels.stats.unrealizedPnl}
            value={signedMoney(totals?.unrealizedPnl ?? null)}
          />
          {model.greeks && (
            <>
              <StatBlock
                className={SUMMARY_STAT}
                valueClassName={SUMMARY_VALUE}
                label={labels.stats.delta}
                value={formatDecimal(model.greeks.delta, 0)}
              />
              <StatBlock
                className={SUMMARY_STAT}
                valueClassName={SUMMARY_VALUE}
                label={labels.stats.theta}
                value={`${formatPriceBRL(model.greeks.theta)} ${t.builder.greeksPanel.thetaUnit}`}
              />
              <StatBlock
                className={SUMMARY_STAT}
                valueClassName={SUMMARY_VALUE}
                label={labels.stats.vega}
                value={`${formatPriceBRL(model.greeks.vega)} ${t.builder.greeksPanel.vegaUnit}`}
              />
            </>
          )}
        </div>
      </Panel>
      {valuation && <RiskNotice breaches={valuation.limitBreaches} />}
      {model.valuation && !model.valuation.ok && (
        <p role="alert" className="text-[12px]" style={{ color: "var(--danger)" }}>
          {labels.valuationError}
        </p>
      )}
      {valuation && valuation.notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {valuation.notes.map((note) => (
            <li key={`${note.code}-${note.message}`} className="text-muted-foreground text-[12px]">
              {note.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PortfolioDashboard({
  model,
  decisionSlot,
  analysisSlot,
}: {
  model: PortfolioReadModel;
  decisionSlot?: OperationDecisionSlot;
  analysisSlot?: OperationDecisionSlot;
}) {
  const labelOf = new Map(
    model.operations.map(({ operation }) => [
      operation.id,
      `${operation.underlying} · ${session(operation.openedAt)}`,
    ]),
  );
  const fills: FillRow[] = [...model.fills].reverse().map((fill) => ({
    id: fill.id,
    date: session(fill.session),
    side: fill.side,
    ticker: fill.ticker,
    quantity: fill.quantity,
    price: fill.price,
    costsCentavos: fill.costsCentavos,
    source: fill.source,
    operationLabel: fill.operationId ? (labelOf.get(fill.operationId) ?? fill.operationId) : null,
  }));
  const openOperations = model.operations
    .filter(({ operation, pendingSettlement }) => operation.status === "open" && !pendingSettlement)
    .map(({ operation }) => ({
      id: operation.id,
      label: labelOf.get(operation.id) ?? operation.id,
    }));

  return (
    <div className="@container">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-[14px] @min-[64rem]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="order-2 flex min-w-0 flex-col gap-[14px] @min-[64rem]:order-1">
          <PendingSettlements model={model} />
          <Panel title={labels.positions.title}>
            <PositionsTable rows={model.positions} />
            {model.unknownSeries.length > 0 && (
              <p className="text-muted-foreground text-[12px]">
                <span className="font-mono uppercase">
                  {model.unknownSeries.map((holding) => holding.ticker).join(", ")}
                </span>
                : {labels.positions.unknownSeries}
              </p>
            )}
          </Panel>
          <Panel title={labels.operations.title}>
            <OperationsTable
              model={model}
              decisionSlot={decisionSlot}
              analysisSlot={analysisSlot}
            />
          </Panel>
          <OpenOperationPayoffsPanel operations={model.operations} />
          <Panel title={labels.fills.title}>
            <FillsPanel fills={fills} openOperations={openOperations} />
          </Panel>
        </div>
        <Summary model={model} />
      </div>
    </div>
  );
}
