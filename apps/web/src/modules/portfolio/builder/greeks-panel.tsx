import type { Greeks } from "@fetha/engine";

import { formatPriceBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";

import { t } from "../strings";

function GreekValue({
  label,
  value,
  token,
}: {
  label: string;
  value: string;
  token: "--greek-delta" | "--greek-gamma" | "--greek-theta" | "--greek-vega";
}) {
  return (
    <div className="border-line-soft flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</p>
      <p className="font-mono text-[15px] tabular-nums" style={{ color: `var(${token})` }}>
        {value}
      </p>
    </div>
  );
}

export function GreeksPanel({ greeks }: { greeks: Greeks }) {
  return (
    <div className="flex flex-col gap-3">
      <GreekValue
        label={t.builder.greeksPanel.delta}
        value={formatDecimal(greeks.delta, 4)}
        token="--greek-delta"
      />
      <GreekValue
        label={t.builder.greeksPanel.gamma}
        value={formatDecimal(greeks.gamma, 4)}
        token="--greek-gamma"
      />
      <GreekValue
        label={t.builder.greeksPanel.theta}
        value={`${formatPriceBRL(greeks.theta)} ${t.builder.greeksPanel.thetaUnit}`}
        token="--greek-theta"
      />
      <GreekValue
        label={t.builder.greeksPanel.vega}
        value={`${formatPriceBRL(greeks.vega)} ${t.builder.greeksPanel.vegaUnit}`}
        token="--greek-vega"
      />
    </div>
  );
}
