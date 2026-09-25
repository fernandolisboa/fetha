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
import { GroupExpiredButton, UngroupButton } from "./operation-buttons";
import { SettlementDialog, type SettlementLegView } from "./settlement-dialog";

const labels = t.dashboard;

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
    <span className="flex flex-col items-end">
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
    <Table>
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
          return (
            <TableRow key={`${row.holding.ticker}-${row.holding.expiry ?? ""}`}>
              <TableCell className="font-mono uppercase">
                {row.holding.ticker}
                {row.holding.expiry && (
                  <span className="text-muted-foreground ml-2 text-[11px] normal-case">
                    {session(row.holding.expiry)}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-[12px]">
                {instrumentType(row)}
              </TableCell>
              <TableCell
                className="text-right font-mono tabular-nums"
                style={{ color: quantity > 0 ? "var(--up)" : "var(--down)" }}
              >
                {formatDecimal(String(quantity) as DecimalString, 0)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatDecimal(row.holding.position.averageCost)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                <PriceCell row={row} />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {row.valuation?.value === null || row.valuation === null
                  ? "—"
                  : formatBRL(row.valuation.value)}
              </TableCell>
              <TableCell
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

function settlementLegs(
  pending: PortfolioReadModel["pendingSettlements"][number],
): SettlementLegView[] {
  if (!pending.proposal) return [];
  return pending.proposal.legs.map((settlement) => ({
    ticker: settlement.leg.ticker,
    role: settlement.leg.role,
    side: settlement.leg.side,
    quantity: settlement.leg.quantity,
    strike: (pending.strikes[settlement.leg.ticker] as DecimalString | undefined) ?? null,
    intrinsicValue: settlement.intrinsicValue,
    proposed: settlement.outcome,
  }));
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
            {pending.proposal ? (
              <SettlementDialog
                operationId={pending.operation.id}
                underlying={pending.operation.underlying}
                expiry={session(pending.proposal.expiry)}
                underlyingClose={pending.proposal.underlyingClose}
                legs={settlementLegs(pending)}
              />
            ) : (
              <span className="text-[12px]" style={{ color: "var(--warning)" }}>
                {labels.settlements.proposalError}
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

function OperationsTable({ model }: { model: PortfolioReadModel }) {
  if (model.operations.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{labels.operations.empty}</p>;
  }
  return (
    <Table>
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
        {model.operations.map(({ operation, state, valuation, pendingSettlement }) => (
          <TableRow key={operation.id}>
            <TableCell className="font-mono uppercase">{operation.underlying}</TableCell>
            <TableCell className="text-[12px]">
              {pendingSettlement ? (
                <span style={{ color: "var(--warning)" }}>
                  {labels.operations.pendingSettlement}
                </span>
              ) : (
                labels.operations.statuses[operation.status]
              )}
            </TableCell>
            <TableCell className="font-mono tabular-nums">{session(operation.openedAt)}</TableCell>
            <TableCell className="font-mono tabular-nums">
              {operation.expiry ? session(operation.expiry) : "—"}
            </TableCell>
            <TableCell className="font-mono text-[12px]">
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
              className="text-right font-mono tabular-nums"
              style={{ color: tone(valuation?.unrealizedPnl ?? null) }}
            >
              {signedMoney(valuation?.unrealizedPnl ?? null)}
            </TableCell>
            <TableCell className="text-right">
              {operation.status === "open" && !pendingSettlement && (
                <UngroupButton operationId={operation.id} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Summary({ model }: { model: PortfolioReadModel }) {
  const valuation = model.valuation?.ok ? model.valuation.value : null;
  const totals = valuation?.totals;
  return (
    <div className="flex flex-col gap-[14px]">
      <Panel>
        <div className="flex flex-col gap-3">
          <StatBlock
            label={labels.stats.equity}
            value={formatBRL(totals?.equity ?? (model.cash as Centavos))}
          />
          <StatBlock
            label={labels.stats.cash}
            value={formatBRL(model.cash as Centavos)}
            sub={labels.stats.cashSub}
          />
          <StatBlock
            label={labels.stats.unrealizedPnl}
            value={signedMoney(totals?.unrealizedPnl ?? null)}
          />
          {model.greeks && (
            <>
              <StatBlock label={labels.stats.delta} value={formatDecimal(model.greeks.delta, 0)} />
              <StatBlock
                label={labels.stats.theta}
                value={`${formatPriceBRL(model.greeks.theta)} ${t.builder.greeksPanel.thetaUnit}`}
              />
              <StatBlock
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

export function PortfolioDashboard({ model }: { model: PortfolioReadModel }) {
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
    <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-[14px]">
      <div className="flex min-w-0 flex-col gap-[14px]">
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
          <OperationsTable model={model} />
        </Panel>
        <Panel title={labels.fills.title}>
          <FillsPanel fills={fills} openOperations={openOperations} />
        </Panel>
      </div>
      <Summary model={model} />
    </div>
  );
}
