import Link from "next/link";
import type { Metadata } from "next";

import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/db/client";
import { requireUser } from "@/modules/auth";
import {
  allowedDecisionKinds,
  defaultHorizonsForOperations,
  getMyDecisionsByOperationId,
  t as decisionsT,
} from "@/modules/decisions";
import { DecisionBar } from "@/modules/decisions/client";
import { formatBRL } from "@/lib/format/brl";
import { formatDate, formatDateTime } from "@/lib/format/date-time";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { getMyOperations, getMyPortfolio, PortfolioDashboard, t } from "@/modules/portfolio";
import { ImportFillsDialog, RecordFillDialog } from "@/modules/portfolio/client";
import { Panel, t as shellStrings } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.portfolio}` };

export default async function PortfolioPage() {
  await requireUser();
  const [portfolio, operations] = await Promise.all([getMyPortfolio(), getMyOperations()]);

  const operationIds = operations.map((operation) => operation.id);
  const [decisionsByOperation, defaultHorizons] = await Promise.all([
    getMyDecisionsByOperationId(operationIds),
    defaultHorizonsForOperations(getDb(), operations),
  ]);

  return (
    <div className="flex flex-col gap-6 px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {shellStrings.destinations.portfolio} · {t.dashboard.markedAt}{" "}
            <span className="font-mono tabular-nums">{formatDateTime(new Date(portfolio.at))}</span>
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight">{t.dashboard.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/carteira/nova-operacao" className={buttonVariants({ variant: "ghost" })}>
            {t.list.newOperation}
          </Link>
          <RecordFillDialog today={todaySaoPauloDate()} />
          <ImportFillsDialog />
        </div>
      </div>

      <PortfolioDashboard model={portfolio} />

      <Panel title={t.list.title}>
        {operations.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">{t.list.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.list.columns.underlying}</TableHead>
                <TableHead>{t.list.columns.date}</TableHead>
                <TableHead className="text-right">{t.list.columns.netPremium}</TableHead>
                <TableHead className="text-right">{t.list.columns.maxLoss}</TableHead>
                <TableHead className="text-right">{t.list.columns.breach}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {operations.map((operation) => {
                const decision = decisionsByOperation.get(operation.id) ?? null;
                return (
                  <TableRow key={operation.id}>
                    <TableCell className="font-mono uppercase">{operation.underlying}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatDate(operation.createdAt)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatBRL(operation.netPremiumCentavos)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {operation.maxLossCentavos === null
                        ? "—"
                        : formatBRL(operation.maxLossCentavos)}
                    </TableCell>
                    <TableCell className="text-right">
                      {operation.breachedLimits.length > 0 ? (
                        <span
                          className="font-mono text-[12px] tabular-nums"
                          style={{ color: "var(--warning)" }}
                        >
                          {operation.breachedLimits.length}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {decision ? (
                        <span className="text-muted-foreground text-xs">
                          {decisionsT.kind[decision.kind]} · {formatDate(decision.decidedAt)}
                        </span>
                      ) : (
                        <DecisionBar
                          originKind="contemplated_operation"
                          targetId={operation.id}
                          allowedKinds={allowedDecisionKinds({ kind: "contemplated_operation" })}
                          defaultHorizon={defaultHorizons.get(operation.id) ?? null}
                          defaultInstrument={operation.underlying}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
