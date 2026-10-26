import { decimalStringSchema, type Centavos } from "@fetha/contracts";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";

import type { LotLeg } from "../lot-legs";
import { t } from "../strings";
import { legText } from "./radar-facts";

export function lotLegText(leg: LotLeg): string {
  const quantity = formatDecimal(decimalStringSchema.parse(String(leg.quantity)), 0);
  return `${quantity} × ${legText(leg)} · ${t.suggestions.legPrice(formatPriceBRL(leg.price))}`;
}

// DESIGN.md's money convention, as the builder's StatBlocks: a credit reads "+ R$".
export function netPremiumText(value: Centavos): string {
  return value > 0 ? `+ ${formatBRL(value)}` : formatBRL(value);
}

export function Figure({ label, value, token }: { label: string; value: string; token?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</dt>
      <dd
        className="font-mono text-[13px] tabular-nums"
        style={token ? { color: `var(${token})` } : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
