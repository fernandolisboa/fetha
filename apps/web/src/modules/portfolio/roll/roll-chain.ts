import type { Centavos } from "@fetha/contracts";

export interface OperationLink {
  id: string;
  rolledFromOperationId: string | null;
}

// Every operation id in the chain containing `id`, oldest first (#382): walks back through
// `rolledFromOperationId` to the chain's root, then forward through whichever operation names
// each link as its own `rolledFromOperationId`, so the page for any link in the chain (not only
// the newest) shows the whole history. A chain of one (an operation never rolled, and nothing
// rolled from it) is just `[id]`.
export function chainIdsFrom(operations: readonly OperationLink[], id: string): string[] {
  const parentOf = new Map(
    operations.map((operation) => [operation.id, operation.rolledFromOperationId]),
  );
  const childOf = new Map<string, string>();
  for (const operation of operations) {
    if (operation.rolledFromOperationId) {
      childOf.set(operation.rolledFromOperationId, operation.id);
    }
  }
  let root = id;
  const seen = new Set([root]);
  for (let parent = parentOf.get(root); parent; parent = parentOf.get(root)) {
    if (seen.has(parent)) break;
    root = parent;
    seen.add(root);
  }
  const chain: string[] = [];
  const visited = new Set<string>();
  for (let node: string | undefined = root; node && !visited.has(node); node = childOf.get(node)) {
    visited.add(node);
    chain.push(node);
  }
  return chain;
}

// One operation in a roll chain (#382): the month it closed, expired or (for the still-open last
// link) opened in (an ISO "YYYY-MM", the chain's own calendar unit — rolls happen monthly,
// ADR-0080), and the net credit/debit that link's own fills carried: for a closed link, its
// closing cash plus the opening cash that created it (what was received or paid rolling into and
// out of it); for the chain's still-open last link, only the opening cash, since nothing has
// closed it yet. Centavos stay integers end to end; only `rollChainToCsv` converts to a plain
// decimal at the export boundary.
export interface RollChainEntry {
  operationId: string;
  month: string;
  netCentavos: Centavos;
}

export interface RollChainRow {
  month: string;
  operationIds: string[];
  netCentavos: Centavos;
  runningTotalCentavos: Centavos;
}

// Groups the chain's entries by month (more than one in the same month sums, rather than one
// row silently shadowing another) and carries a running total forward across months in
// chronological order; integer centavos addition throughout, so no rounding ever creeps in.
export function aggregateRollChainByMonth(entries: readonly RollChainEntry[]): RollChainRow[] {
  const byMonth = new Map<string, { operationIds: string[]; netCentavos: number }>();
  for (const entry of entries) {
    const existing = byMonth.get(entry.month);
    if (existing) {
      existing.operationIds.push(entry.operationId);
      existing.netCentavos += entry.netCentavos;
    } else {
      byMonth.set(entry.month, {
        operationIds: [entry.operationId],
        netCentavos: entry.netCentavos,
      });
    }
  }
  const months = [...byMonth.keys()].sort();
  let runningTotal = 0;
  return months.map((month) => {
    const group = byMonth.get(month);
    if (!group) throw new Error("unreachable: month came from this map's own keys");
    runningTotal += group.netCentavos;
    return {
      month,
      operationIds: group.operationIds,
      netCentavos: group.netCentavos as Centavos,
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
  const header = "month,operation_ids,net,running_total";
  const lines = rows.map((row) =>
    [
      row.month,
      csvField(row.operationIds.join(";")),
      centavosToPlainDecimal(row.netCentavos),
      centavosToPlainDecimal(row.runningTotalCentavos),
    ].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}
