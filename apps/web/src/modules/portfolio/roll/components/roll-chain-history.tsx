import type { Centavos } from "@fetha/contracts";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/format/brl";
import { Panel } from "@/modules/shell";

import { t } from "../../strings";
import { getMyRollChain } from "../roll-chain-queries";

import { RollChainDownloadButton } from "./roll-chain-download-button";

const labels = t.roll.chain;

function signedBRL(value: Centavos): string {
  return value > 0 ? `+ ${formatBRL(value)}` : formatBRL(value);
}

export async function RollChainHistory({ operationId }: { operationId: string }) {
  const rows = await getMyRollChain(operationId);
  if (rows.length === 0) {
    return (
      <Panel title={labels.title}>
        <p className="text-muted-foreground text-[13px]">{labels.empty}</p>
      </Panel>
    );
  }

  return (
    <Panel title={labels.title}>
      <Table stacked>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.month}</TableHead>
            <TableHead className="text-right">{labels.net}</TableHead>
            <TableHead className="text-right">{labels.runningTotal}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.month}>
              <TableCell data-stack="title" className="font-mono tabular-nums">
                {row.month}
              </TableCell>
              <TableCell
                data-label={labels.net}
                className="text-right font-mono tabular-nums"
                style={{ color: row.netCentavos >= 0 ? "var(--up)" : "var(--down)" }}
              >
                {row.openOperationId !== null && (
                  <span className="text-muted-foreground mr-1 text-[11px] normal-case">
                    {labels.open}
                  </span>
                )}
                {signedBRL(row.netCentavos)}
              </TableCell>
              <TableCell
                data-label={labels.runningTotal}
                className="text-right font-mono tabular-nums"
                style={{ color: row.runningTotalCentavos >= 0 ? "var(--up)" : "var(--down)" }}
              >
                {signedBRL(row.runningTotalCentavos)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end">
        <RollChainDownloadButton operationId={operationId} />
      </div>
    </Panel>
  );
}
