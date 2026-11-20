"use client";

import { decimalStringSchema, quantitySchema } from "@fetha/contracts";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSessionDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";

import { t } from "../strings";
import { SeriesPicker } from "./series-picker";
import type { BuilderLeg, ChainSeries } from "./types";

function roleLabel(role: BuilderLeg["template"]["role"]): string {
  if (role === "call") return t.builder.legsTable.call;
  if (role === "put") return t.builder.legsTable.put;
  return t.builder.legsTable.stock;
}

// The cycle the other option legs already sit in: a structure's legs share
// one expiry, so this leg's picker opens on it.
function otherLegsExpiry(legs: BuilderLeg[], chain: ChainSeries[]): string | null {
  for (const builderLeg of legs) {
    if (builderLeg.template.role === "stock" || !builderLeg.leg) continue;
    const series = chain.find((candidate) => candidate.ticker === builderLeg.leg?.ticker);
    if (series) return series.expiry;
  }
  return null;
}

export function LegsTable({
  underlying,
  legs,
  chain,
  spot,
  onChangeTicker,
  onChangeQuantity,
}: {
  underlying: string;
  legs: BuilderLeg[];
  chain: ChainSeries[];
  spot: { value: string; session: string } | null;
  onChangeTicker: (index: number, ticker: string) => void;
  onChangeQuantity: (index: number, quantity: number) => void;
}) {
  return (
    <Table stacked>
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
          const options = chain.filter((series) => series.right === template.role);
          const legsExpiry = otherLegsExpiry(
            legs.filter((_, position) => position !== index),
            chain,
          );
          const selected = options.find((series) => series.ticker === leg?.ticker);

          return (
            <TableRow key={index}>
              <TableCell
                data-stack="title"
                className="font-medium"
                style={{ color: template.side === "buy" ? "var(--up)" : "var(--down)" }}
              >
                {template.side === "buy" ? t.builder.legsTable.buy : t.builder.legsTable.sell}
              </TableCell>
              <TableCell data-label={t.builder.legsTable.type}>
                {roleLabel(template.role)}
              </TableCell>
              <TableCell
                data-label={t.builder.legsTable.instrument}
                data-stack="full"
                className="font-mono uppercase"
              >
                {isStock ? (
                  underlying
                ) : (
                  <SeriesPicker
                    label={`${t.builder.legsTable.instrument} ${String(index + 1)}`}
                    underlying={underlying}
                    options={options}
                    legsExpiry={legsExpiry}
                    spot={spot}
                    value={leg?.ticker ?? null}
                    onChange={(ticker) => {
                      onChangeTicker(index, ticker);
                    }}
                  />
                )}
              </TableCell>
              <TableCell
                data-label={t.builder.legsTable.strike}
                className="text-right font-mono tabular-nums"
              >
                {selected ? formatDecimal(decimalStringSchema.parse(selected.strike)) : "—"}
              </TableCell>
              <TableCell data-label={t.builder.legsTable.expiry} className="font-mono tabular-nums">
                {selected ? formatSessionDate(selected.expiry) : "—"}
              </TableCell>
              <TableCell data-label={t.builder.legsTable.quantity} className="text-right">
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
              <TableCell
                data-label={t.builder.legsTable.price}
                className="text-right font-mono tabular-nums"
              >
                {valuation?.price ? formatDecimal(valuation.price) : "—"}
                {valuation?.stale ? (
                  <span className="ml-1 text-[10px]" style={{ color: "var(--warning)" }}>
                    {t.builder.legsTable.stale}
                  </span>
                ) : null}
              </TableCell>
              <TableCell
                data-label={t.builder.legsTable.delta}
                className="text-right font-mono tabular-nums"
              >
                {valuation?.greeks ? formatDecimal(valuation.greeks.delta, 4) : "—"}
              </TableCell>
              <TableCell
                data-label={t.builder.legsTable.iv}
                className="text-right font-mono tabular-nums"
              >
                {valuation?.impliedVolatility ? formatPercent(valuation.impliedVolatility) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
