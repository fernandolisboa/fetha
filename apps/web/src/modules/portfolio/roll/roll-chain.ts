import type { Centavos } from "@fetha/contracts";

// One operation in a roll chain (#382): the month it closed or expired in (an ISO "YYYY-MM",
// the chain's own calendar unit — rolls happen monthly, ADR-0080), and the signed cash flow that
// month's roll (or final close) carried. Centavos stay integers end to end; only
// `rollChainToCsv` converts to a plain decimal at the export boundary.
export interface RollChainEntry {
  operationId: string;
  month: string;
  resultCentavos: Centavos;
}

export interface RollChainRow {
  month: string;
  operationIds: string[];
  resultCentavos: Centavos;
  runningTotalCentavos: Centavos;
}

// Groups the chain's entries by month (more than one in the same month sums, rather than one
// row silently shadowing another) and carries a running total forward across months in
// chronological order; integer centavos addition throughout, so no rounding ever creeps in.
export function aggregateRollChainByMonth(entries: readonly RollChainEntry[]): RollChainRow[] {
  const byMonth = new Map<string, { operationIds: string[]; resultCentavos: number }>();
  for (const entry of entries) {
    const existing = byMonth.get(entry.month);
    if (existing) {
      existing.operationIds.push(entry.operationId);
      existing.resultCentavos += entry.resultCentavos;
    } else {
      byMonth.set(entry.month, {
        operationIds: [entry.operationId],
        resultCentavos: entry.resultCentavos,
      });
    }
  }
  const months = [...byMonth.keys()].sort();
  let runningTotal = 0;
  return months.map((month) => {
    const group = byMonth.get(month);
    if (!group) throw new Error("unreachable: month came from this map's own keys");
    runningTotal += group.resultCentavos;
    return {
      month,
      operationIds: group.operationIds,
      resultCentavos: group.resultCentavos as Centavos,
      runningTotalCentavos: runningTotal as Centavos,
    };
  });
}

function centavosToPlainDecimal(centavos: Centavos): string {
  const sign = centavos < 0 ? "-" : "";
  const absolute = Math.abs(centavos);
  const reais = Math.floor(absolute / 100).toString();
  const cents = (absolute % 100).toString().padStart(2, "0");
  return `${sign}${reais}.${cents}`;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Plain decimal numbers and ISO dates, not pt-BR formatting (#382): a spreadsheet re-import or a
// script reading this file should never have to locale-parse it, unlike the screen's own table.
export function rollChainToCsv(rows: readonly RollChainRow[]): string {
  const header = "month,operation_ids,result,running_total";
  const lines = rows.map((row) =>
    [
      row.month,
      csvField(row.operationIds.join(";")),
      centavosToPlainDecimal(row.resultCentavos),
      centavosToPlainDecimal(row.runningTotalCentavos),
    ].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}
