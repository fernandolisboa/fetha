import { Decimal } from "decimal.js";
import { decimalStringSchema } from "@fetha/contracts";
import type { Greeks } from "@fetha/engine";

import { formatPriceBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";

import type { CalibrationLine } from "../calibration";
import { t } from "../strings";

function signedPriceBRL(value: string): string {
  const formatted = formatPriceBRL(decimalStringSchema.parse(value));
  return new Decimal(value).isPositive() ? `+${formatted}` : formatted;
}

function Greek({
  color,
  label,
  small,
  children,
}: {
  color: string;
  label: string;
  small: string;
  children: string;
}) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-2">
      <dt className="text-xs" style={{ color }}>
        {label}
        <small className="text-faint block text-[11px]">{small}</small>
      </dt>
      <dd className="text-[13px] text-pretty">{children}</dd>
    </div>
  );
}

// The card's "Detalhes" disclosure (docs/adr/0067's redesign): each greek told as a plain,
// sign-aware sentence instead of a bare number, plus the recipe's own calibration when it has
// scored suggestions to show one — never invented, both straight from the engine and the
// journal.
export function GreekNotes({
  greeks,
  calibration,
}: {
  greeks: Greeks;
  calibration?: CalibrationLine | null;
}) {
  const theta = new Decimal(greeks.theta);
  const vega = new Decimal(greeks.vega);
  const delta = new Decimal(greeks.delta);
  const gamma = new Decimal(greeks.gamma);

  return (
    <dl className="mt-2 grid grid-cols-1 gap-2 @min-[44rem]:grid-cols-2 @min-[44rem]:gap-x-6">
      <Greek
        color="var(--greek-theta)"
        label={t.suggestions.greeks.theta.label}
        small={t.suggestions.greeks.theta.small}
      >
        {theta.isNegative()
          ? t.suggestions.greekSentence.thetaNegative(signedPriceBRL(greeks.theta))
          : t.suggestions.greekSentence.thetaPositive(signedPriceBRL(greeks.theta))}
      </Greek>
      <Greek
        color="var(--greek-vega)"
        label={t.suggestions.greeks.vega.label}
        small={t.suggestions.greeks.vega.small}
      >
        {vega.isNegative()
          ? t.suggestions.greekSentence.vegaNegative(signedPriceBRL(greeks.vega))
          : t.suggestions.greekSentence.vegaPositive(signedPriceBRL(greeks.vega))}
      </Greek>
      <Greek
        color="var(--greek-delta)"
        label={t.suggestions.greeks.delta.label}
        small={t.suggestions.greeks.delta.small}
      >
        {delta.isZero()
          ? t.suggestions.greekSentence.deltaNeutral
          : delta.isPositive()
            ? t.suggestions.greekSentence.deltaBought(
                formatDecimal(decimalStringSchema.parse(delta.abs().toString()), 0),
              )
            : t.suggestions.greekSentence.deltaSold(
                formatDecimal(decimalStringSchema.parse(delta.abs().toString()), 0),
              )}
      </Greek>
      <Greek
        color="var(--greek-gamma)"
        label={t.suggestions.greeks.gamma.label}
        small={t.suggestions.greeks.gamma.small}
      >
        {gamma.isZero()
          ? t.suggestions.greekSentence.gammaNeutral
          : gamma.isNegative()
            ? t.suggestions.greekSentence.gammaAgainst(formatDecimal(greeks.gamma, 0))
            : t.suggestions.greekSentence.gammaFor(formatDecimal(greeks.gamma, 0))}
      </Greek>
      {calibration && calibration.claimed > 0 && (
        <Greek
          label={t.suggestions.greeks.history.label}
          small={t.suggestions.greeks.history.small}
          color="var(--muted)"
        >
          {t.suggestions.greekSentence.recipeHistory(calibration.held, calibration.claimed)}
        </Greek>
      )}
    </dl>
  );
}
