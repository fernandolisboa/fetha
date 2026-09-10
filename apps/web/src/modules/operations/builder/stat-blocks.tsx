import type { Centavos, DecimalString } from "@fetha/contracts";

import { formatBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";

import { t } from "../strings";

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</p>
      <p className="font-mono text-[18px]">{value}</p>
    </div>
  );
}

function moneyOrUnbounded(value: Centavos | "unbounded"): string {
  return value === "unbounded" ? t.builder.statBlocks.unbounded : formatBRL(value);
}

export function StatBlocks({
  netPremium,
  maxLoss,
  maxGain,
  breakEvens,
}: {
  netPremium: Centavos;
  maxLoss: Centavos | "unbounded";
  maxGain: Centavos | "unbounded";
  breakEvens: DecimalString[];
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatBlock label={t.builder.statBlocks.netPremium} value={formatBRL(netPremium)} />
      <StatBlock label={t.builder.statBlocks.maxLoss} value={moneyOrUnbounded(maxLoss)} />
      <StatBlock label={t.builder.statBlocks.maxGain} value={moneyOrUnbounded(maxGain)} />
      <StatBlock
        label={t.builder.statBlocks.breakEvens}
        value={
          breakEvens.length > 0 ? breakEvens.map((value) => formatDecimal(value)).join(" / ") : "—"
        }
      />
    </div>
  );
}
