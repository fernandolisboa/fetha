import { decimalStringSchema } from "@fetha/contracts";

import { formatDecimal } from "@/lib/format/decimal";
import { formatPriceBRL } from "@/lib/format/brl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { LotLeg } from "../lot-legs";
import { t } from "../strings";
import { displayDate } from "./radar-facts";

// The lot as a table (docs/adr/0067, amended 2026-11-21), shared by the suggestion and research
// cards: Operação carries the series ticker as a muted second line, since the ticker is for the
// broker, not for reading. A shared option expiry is said once under the table ("As opções
// vencem em" when a stock leg sits beside them, since the stock itself never expires; "Todas
// vencem em" would misstate that); legs that disagree on it (a calendar structure) get their own
// Vencimento column instead. Always a plain table, never the stacked phone layout (review
// finding #14): four tight columns fit comfortably inside the card's narrowest column.
export function LegsTable({ legs }: { legs: readonly LotLeg[] }) {
  const optionLegs = legs.filter((leg) => leg.role !== "stock" && leg.expiry);
  const expiries = new Set(optionLegs.map((leg) => leg.expiry));
  const commonExpiry = expiries.size === 1 ? (optionLegs[0]?.expiry ?? null) : null;
  const showExpiryColumn = expiries.size > 1;
  const hasStockLeg = legs.some((leg) => leg.role === "stock");

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
        {t.suggestions.legsTable.title}
      </p>
      <Table className="text-[12px]">
        <TableHeader>
          <TableRow>
            <TableHead className="px-1.5 py-1">{t.suggestions.legsTable.operation}</TableHead>
            <TableHead className="px-1.5 py-1 text-right">
              {t.suggestions.legsTable.quantity}
            </TableHead>
            <TableHead className="px-1.5 py-1 text-right">
              {t.suggestions.legsTable.strike}
            </TableHead>
            {showExpiryColumn && (
              <TableHead className="px-1.5 py-1">{t.suggestions.legsTable.expiry}</TableHead>
            )}
            <TableHead className="px-1.5 py-1 text-right">
              {t.suggestions.legsTable.price}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {legs.map((leg) => (
            <TableRow key={`${leg.side}-${leg.ticker}`}>
              <TableCell className="px-1.5 py-1">
                {t.legs.side[leg.side]} {t.legs.role[leg.role]}
                <span className="text-faint block font-mono text-[11px]">{leg.ticker}</span>
              </TableCell>
              <TableCell className="px-1.5 py-1 text-right font-mono tabular-nums">
                {formatDecimal(decimalStringSchema.parse(String(leg.quantity)), 0)}
              </TableCell>
              <TableCell className="px-1.5 py-1 text-right font-mono tabular-nums">
                {leg.strike ? formatDecimal(leg.strike) : "—"}
              </TableCell>
              {showExpiryColumn && (
                <TableCell className="px-1.5 py-1 font-mono tabular-nums">
                  {leg.expiry ? displayDate(leg.expiry) : "—"}
                </TableCell>
              )}
              <TableCell className="px-1.5 py-1 text-right font-mono tabular-nums">
                {formatPriceBRL(leg.price)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {commonExpiry && (
        <p className="text-muted-foreground text-xs">
          {hasStockLeg
            ? t.suggestions.legsTable.optionsExpire(displayDate(commonExpiry))
            : t.suggestions.legsTable.allExpire(displayDate(commonExpiry))}
        </p>
      )}
    </div>
  );
}
