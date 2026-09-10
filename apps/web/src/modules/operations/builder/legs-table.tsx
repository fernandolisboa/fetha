"use client";

import { quantitySchema } from "@fetha/contracts";

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

import { t } from "../strings";
import type { BuilderLeg, ChainSeries } from "./types";

function roleLabel(role: BuilderLeg["template"]["role"]): string {
  if (role === "call") return t.builder.legsTable.call;
  if (role === "put") return t.builder.legsTable.put;
  return t.builder.legsTable.stock;
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
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.builder.legsTable.side}</TableHead>
          <TableHead>{t.builder.legsTable.type}</TableHead>
          <TableHead>{t.builder.legsTable.instrument}</TableHead>
          <TableHead>{t.builder.legsTable.strike}</TableHead>
          <TableHead>{t.builder.legsTable.expiry}</TableHead>
          <TableHead>{t.builder.legsTable.quantity}</TableHead>
          <TableHead>{t.builder.legsTable.price}</TableHead>
          <TableHead>{t.builder.legsTable.delta}</TableHead>
          <TableHead>{t.builder.legsTable.iv}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {legs.map((builderLeg, index) => {
          const { template, leg, valuation } = builderLeg;
          const isStock = template.role === "stock";
          const options = chain.filter((series) => series.right === template.role);
          const selected = options.find((series) => series.ticker === leg?.ticker);

          return (
            <TableRow key={index}>
              <TableCell>
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
                          {series.ticker}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </TableCell>
              <TableCell className="font-mono">{selected ? selected.strike : "—"}</TableCell>
              <TableCell className="font-mono">{selected ? selected.expiry : "—"}</TableCell>
              <TableCell>
                <Input
                  aria-label={`${t.builder.legsTable.quantity} ${String(index + 1)}`}
                  inputMode="numeric"
                  className="w-20"
                  value={leg ? String(leg.quantity) : ""}
                  onChange={(event) => {
                    const parsed = quantitySchema.safeParse(Number(event.target.value));
                    if (parsed.success) {
                      onChangeQuantity(index, parsed.data);
                    }
                  }}
                />
              </TableCell>
              <TableCell className="font-mono">
                {valuation?.price ? formatDecimal(valuation.price) : "—"}
              </TableCell>
              <TableCell className="font-mono">
                {valuation?.greeks ? formatDecimal(valuation.greeks.delta, 4) : "—"}
              </TableCell>
              <TableCell className="font-mono">
                {valuation?.impliedVolatility ? formatDecimal(valuation.impliedVolatility, 4) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
