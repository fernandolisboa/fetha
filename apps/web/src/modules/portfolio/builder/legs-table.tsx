"use client";

import { decimalStringSchema, quantitySchema } from "@fetha/contracts";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";

import { t } from "../strings";
import type { BuilderLeg, ChainSeries } from "./types";

function roleLabel(role: BuilderLeg["template"]["role"]): string {
  if (role === "call") return t.builder.legsTable.call;
  if (role === "put") return t.builder.legsTable.put;
  return t.builder.legsTable.stock;
}

// The expiry of the first option leg the user has picked, locking every
// other option leg's picker to the same cycle: a structure's legs share
// one expiry, and the chain alone allows a call from one cycle next to a
// put from another (round 1 item 3).
function lockedExpiry(legs: BuilderLeg[], chain: ChainSeries[]): string | null {
  for (const builderLeg of legs) {
    if (builderLeg.template.role === "stock" || !builderLeg.leg) continue;
    const series = chain.find((candidate) => candidate.ticker === builderLeg.leg?.ticker);
    if (series) return series.expiry;
  }
  return null;
}

// Priceable series first (the ticket's own diagnosis: a picker offering
// every listed series regardless of whether it ever traded is how "could
// not price this operation" happens), stable within each group so the
// expiry/strike ladder the repository already sorted still reads top to
// bottom inside it.
function byPriceableFirst(a: ChainSeries, b: ChainSeries): number {
  return (a.lastPrice ? 0 : 1) - (b.lastPrice ? 0 : 1);
}

export function LegsTable({
  underlying,
  legs,
  chain,
  onChangeTicker,
  onChangeQuantity,
}: {
  underlying: string;
  legs: BuilderLeg[];
  chain: ChainSeries[];
  onChangeTicker: (index: number, ticker: string) => void;
  onChangeQuantity: (index: number, quantity: number) => void;
}) {
  const expiry = lockedExpiry(legs, chain);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.builder.legsTable.side}</TableHead>
          <TableHead>{t.builder.legsTable.type}</TableHead>
          <TableHead>{t.builder.legsTable.instrument}</TableHead>
          <TableHead className="text-right">{t.builder.legsTable.strike}</TableHead>
          <TableHead>{t.builder.legsTable.expiry}</TableHead>
          <TableHead className="text-right">{t.builder.legsTable.quantity}</TableHead>
          <TableHead className="text-right">{t.builder.legsTable.price}</TableHead>
          <TableHead className="text-right">{t.builder.legsTable.delta}</TableHead>
          <TableHead className="text-right">{t.builder.legsTable.iv}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {legs.map((builderLeg, index) => {
          const { template, leg, valuation } = builderLeg;
          const isStock = template.role === "stock";
          const options = chain
            .filter(
              (series) => series.right === template.role && (!expiry || series.expiry === expiry),
            )
            .slice()
            .sort(byPriceableFirst);
          const selected = options.find((series) => series.ticker === leg?.ticker);

          return (
            <TableRow key={index}>
              <TableCell
                className="font-medium"
                style={{ color: template.side === "buy" ? "var(--up)" : "var(--down)" }}
              >
                {template.side === "buy" ? t.builder.legsTable.buy : t.builder.legsTable.sell}
              </TableCell>
              <TableCell>{roleLabel(template.role)}</TableCell>
              <TableCell className="font-mono uppercase">
                {isStock ? (
                  underlying
                ) : (
                  <Select
                    value={leg?.ticker ?? ""}
                    onValueChange={(value) => {
                      if (value) onChangeTicker(index, value);
                    }}
                  >
                    <SelectTrigger
                      aria-label={`${t.builder.legsTable.instrument} ${String(index + 1)}`}
                    >
                      <SelectValue placeholder={t.builder.legsTable.pickInstrument} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((series) => (
                        <SelectItem key={series.ticker} value={series.ticker}>
                          <span className="font-mono">{series.ticker}</span>
                          {series.lastPrice ? (
                            <span
                              className="ml-2 font-mono text-[11px] tabular-nums"
                              style={{ color: "var(--muted)" }}
                            >
                              {formatDecimal(decimalStringSchema.parse(series.lastPrice.value))} ·{" "}
                              {series.lastPrice.session}
                            </span>
                          ) : (
                            <span className="ml-2 text-[11px]" style={{ color: "var(--faint)" }}>
                              {t.builder.legsTable.noTrades}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {selected ? selected.strike : "—"}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {selected ? selected.expiry : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Input
                  aria-label={`${t.builder.legsTable.quantity} ${String(index + 1)}`}
                  inputMode="numeric"
                  className="w-20 text-right font-mono tabular-nums"
                  value={leg ? String(leg.quantity) : ""}
                  onChange={(event) => {
                    const parsed = quantitySchema.safeParse(Number(event.target.value));
                    if (parsed.success) {
                      onChangeQuantity(index, parsed.data);
                    }
                  }}
                />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {valuation?.price ? formatDecimal(valuation.price) : "—"}
                {valuation?.stale ? (
                  <span className="ml-1 text-[10px]" style={{ color: "var(--warning)" }}>
                    {t.builder.legsTable.stale}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {valuation?.greeks ? formatDecimal(valuation.greeks.delta, 4) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {valuation?.impliedVolatility ? formatPercent(valuation.impliedVolatility) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
