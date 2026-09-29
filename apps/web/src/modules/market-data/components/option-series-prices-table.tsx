import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";

import { sessionDateToDisplayDate } from "../close-freshness";
import type { OptionSeriesPrice } from "../repositories/option-repository";
import { t } from "../strings";

const labels = t.optionSeries.prices;

export function OptionSeriesPricesTable({ prices }: { prices: OptionSeriesPrice[] }) {
  if (prices.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{labels.empty}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{labels.session}</TableHead>
          <TableHead className="text-right">{labels.close}</TableHead>
          <TableHead className="text-right">{labels.average}</TableHead>
          <TableHead className="text-right">{labels.trades}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {prices.map((price) => (
          <TableRow key={price.session}>
            <TableCell className="font-mono tabular-nums">
              {formatDate(sessionDateToDisplayDate(price.session))}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {price.close === null ? (
                <span className="text-muted-foreground">{labels.noTrades}</span>
              ) : (
                formatPriceBRL(price.close)
              )}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {price.average === null ? "—" : formatPriceBRL(price.average)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">{price.trades}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
