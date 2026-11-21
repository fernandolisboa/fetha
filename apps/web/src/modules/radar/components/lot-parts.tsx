import type { ReactNode } from "react";
import type { Centavos, DecimalString } from "@fetha/contracts";

import { formatBRL } from "@/lib/format/brl";
import { formatProbabilityOfProfit } from "@/lib/format/probability-of-profit";

import { gainToRiskRatio } from "../payoff-summary";
import { t } from "../strings";

export function Figure({
  label,
  value,
  hint,
  token,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  token?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</dt>
      <dd
        className="font-mono text-[13px] tabular-nums"
        style={token ? { color: `var(${token})` } : undefined}
      >
        {value}
      </dd>
      {hint && <span className="text-faint text-[11px]">{hint}</span>}
    </div>
  );
}

// Arrisca / Ganha até / Ganho ÷ risco, the three figures both the suggestion and the research
// idea card open with: shared so the two never drift apart on labels or formatting.
export function PayoffFigures({
  maxLoss,
  maxGain,
  probabilityOfProfit,
  className,
}: {
  maxLoss: Centavos;
  maxGain: Centavos | "unbounded";
  probabilityOfProfit?: DecimalString | null;
  className?: string;
}) {
  return (
    <dl
      aria-label={t.suggestions.numbersLabel}
      className={className ?? "grid grid-cols-2 gap-x-6 gap-y-2 @min-[26rem]:grid-cols-4"}
    >
      <Figure
        label={t.suggestions.figures.risked}
        value={formatBRL(maxLoss)}
        hint={t.suggestions.figures.riskedHint}
      />
      <Figure
        label={t.suggestions.figures.gainUpTo}
        value={maxGain === "unbounded" ? t.suggestions.figures.gainUnbounded : formatBRL(maxGain)}
        token="--up"
      />
      <Figure
        label={t.suggestions.figures.gainToRisk}
        value={gainToRiskRatio(maxGain, maxLoss)}
        hint={t.suggestions.figures.gainToRiskHint}
      />
      {probabilityOfProfit != null && (
        <Figure
          label={t.suggestions.figures.probabilityOfProfit}
          value={formatProbabilityOfProfit(probabilityOfProfit)}
          hint={t.suggestions.figures.probabilityOfProfitHint}
        />
      )}
    </dl>
  );
}
