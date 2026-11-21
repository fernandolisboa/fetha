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

// The lot as a table (docs/adr/0067's card redesign), shared by the suggestion and research
// cards: Operação carries the series ticker as a muted second line, since the ticker is for the
// broker, not for reading. A shared expiry is said once under the table; legs that disagree on
// it (a calendar structure) get their own Vencimento column instead.
export function LegsTable({ legs }: { legs: readonly LotLeg[] }) {
  const optionLegs = legs.filter((leg) => leg.role !== "stock" && leg.expiry);
  const expiries = new Set(optionLegs.map((leg) => leg.expiry));
  const commonExpiry = expiries.size === 1 ? (optionLegs[0]?.expiry ?? null) : null;
  const showExpiryColumn = expiries.size > 1;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
        {t.suggestions.legsTable.title}
      </p>
      <Table stacked>
        <TableHeader>
          <TableRow>
            <TableHead>{t.suggestions.legsTable.operation}</TableHead>
            <TableHead className="text-right">{t.suggestions.legsTable.quantity}</TableHead>
            <TableHead className="text-right">{t.suggestions.legsTable.strike}</TableHead>
            {showExpiryColumn && <TableHead>{t.suggestions.legsTable.expiry}</TableHead>}
            <TableHead className="text-right">{t.suggestions.legsTable.price}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {legs.map((leg) => (
            <TableRow key={`${leg.side}-${leg.ticker}`}>
              <TableCell data-stack="title">
                {t.legs.side[leg.side]} {t.legs.role[leg.role]}
                <span className="text-faint block font-mono text-[11px]">{leg.ticker}</span>
              </TableCell>
              <TableCell
                data-label={t.suggestions.legsTable.quantity}
                className="text-right font-mono tabular-nums"
              >
                {formatDecimal(decimalStringSchema.parse(String(leg.quantity)), 0)}
              </TableCell>
              <TableCell
                data-label={t.suggestions.legsTable.strike}
                className="text-right font-mono tabular-nums"
              >
                {leg.strike ? formatDecimal(leg.strike) : "—"}
              </TableCell>
              {showExpiryColumn && (
                <TableCell
                  data-label={t.suggestions.legsTable.expiry}
                  className="font-mono tabular-nums"
                >
                  {leg.expiry ? displayDate(leg.expiry) : "—"}
                </TableCell>
              )}
              <TableCell
                data-label={t.suggestions.legsTable.price}
                className="text-right font-mono tabular-nums"
              >
                {formatPriceBRL(leg.price)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {commonExpiry && (
        <p className="text-muted-foreground text-xs">
          {t.suggestions.legsTable.allExpire(displayDate(commonExpiry))}
        </p>
      )}
    </div>
  );
}
