import type { Greeks } from "@fetha/engine";

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
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</p>
      <p className="font-mono text-[15px]" style={{ color: `var(${token})` }}>
        {value}
      </p>
    </div>
  );
}

export function GreeksPanel({ greeks }: { greeks: Greeks }) {
  return (
    <div>
      <h2 className="text-[13px] font-medium">{t.builder.greeksPanel.title}</h2>
      <div className="mt-2 grid grid-cols-4 gap-4">
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
          value={formatDecimal(greeks.theta, 2)}
          token="--greek-theta"
        />
        <GreekValue
          label={t.builder.greeksPanel.vega}
          value={formatDecimal(greeks.vega, 2)}
          token="--greek-vega"
        />
      </div>
    </div>
  );
}
