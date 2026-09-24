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
  DecisionBar,
  getMyDecisionForOperation,
  resolveDefaultHorizon,
  t as decisionsT,
} from "@/modules/decisions";
import { formatBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { getMyOperations, t, type ContemplatedOperation } from "@/modules/portfolio";
import { EmptyState, Panel, t as shellStrings } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.portfolio}` };

async function OperationDecisionCell({ operation }: { operation: ContemplatedOperation }) {
  const decision = await getMyDecisionForOperation(operation.id);
  if (decision) {
    return (
      <span className="text-muted-foreground text-xs">
        {decisionsT.kind[decision.kind]} · {formatDate(decision.decidedAt)}
      </span>
    );
  }

  const defaultHorizon = await resolveDefaultHorizon(getDb(), operation.legs);

  return (
    <DecisionBar
      originKind="contemplated_operation"
      targetId={operation.id}
      allowedKinds={allowedDecisionKinds({ kind: "contemplated_operation" })}
      defaultHorizon={defaultHorizon}
      defaultInstrument={operation.underlying}
    />
  );
}

export default async function PortfolioPage() {
  await requireUser();
  const operations = await getMyOperations();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {shellStrings.destinations.portfolio}
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight">{t.list.title}</h1>
        </div>
        <Link href="/carteira/nova-operacao" className={buttonVariants()}>
          {t.list.newOperation}
        </Link>
      </div>

      {operations.length === 0 ? (
        <EmptyState sentence={t.list.empty} />
      ) : (
        <Panel>
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
              {operations.map((operation) => (
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
                    <OperationDecisionCell operation={operation} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
