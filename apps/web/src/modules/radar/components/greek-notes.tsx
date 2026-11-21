import { Decimal } from "decimal.js";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";
import type { Greeks, LegValuation } from "@fetha/engine";

import { formatDecimal } from "@/lib/format/decimal";
import { formatPriceBRL } from "@/lib/format/brl";

import type { CalibrationLine } from "../calibration";
import { t } from "../strings";

function signedPriceBRL(value: DecimalString): string {
  const formatted = formatPriceBRL(value);
  return new Decimal(value).isPositive() ? `+${formatted}` : formatted;
}

// Review finding #6: theta/vega must branch on the rounded centavos a viewer actually reads,
// not the raw decimal — a value that rounds to R$ 0,00 needs the neutral sentence, not a
// "working for/against you" claim about a number that displays as zero.
function roundedCentavosSign(value: DecimalString): -1 | 0 | 1 {
  const cents = new Decimal(value).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return cents.isZero() ? 0 : cents.isPositive() ? 1 : -1;
}

// Same idea for delta/gamma, read in shares: a real but small exposure (0,4 ações) must not be
// rounded away into a false "0 ações" claim, so one decimal place is used only when rounding to
// whole shares would otherwise erase a nonzero value; the neutral sentence only fires once the
// displayed figure itself rounds to zero at that finer precision.
function sharesText(value: Decimal): { text: string; isZero: boolean } {
  const abs = value.abs();
  let decimals = 0;
  let rounded = abs.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (rounded.isZero() && !abs.isZero()) {
    decimals = 1;
    rounded = abs.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  }
  return {
    text: formatDecimal(decimalStringSchema.parse(rounded.toString()), decimals),
    isZero: rounded.isZero(),
  };
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

// The card's "Detalhes" disclosure (docs/adr/0067, amended 2026-11-21): each greek told as a
// plain, sign-aware sentence instead of a bare number, plus the recipe's own calibration when it
// has scored suggestions to show one — never invented, both straight from the engine and the
// journal. Finding #7, refined by round 2 finding #3: a leg the engine actually priced but could
// not solve greeks for (`iv_not_converged` is one cause, but not the only one — a note code also
// shared with a harmless rescale) means the aggregate greeks are not whole; read straight from
// the pricing's own legs instead of trusting one note code to say so.
export function GreekNotes({
  greeks,
  legs,
  calibration,
}: {
  greeks: Greeks;
  legs: readonly LegValuation[];
  calibration?: CalibrationLine | null;
}) {
  const incomplete = legs.some((leg) => leg.price !== null && leg.greeks === null);
  const delta = sharesText(new Decimal(greeks.delta));
  const gamma = sharesText(new Decimal(greeks.gamma));
  const thetaSign = roundedCentavosSign(greeks.theta);
  const vegaSign = roundedCentavosSign(greeks.vega);
  const deltaValue = new Decimal(greeks.delta);
  const gammaValue = new Decimal(greeks.gamma);

  return (
    <dl className="mt-2 grid grid-cols-1 gap-2 @min-[44rem]:grid-cols-2 @min-[44rem]:gap-x-6">
      {incomplete ? (
        <p className="text-muted-foreground col-span-full text-[13px]">
          {t.suggestions.greeks.incomplete}
        </p>
      ) : (
        <>
          <Greek
            color="var(--greek-theta)"
            label={t.suggestions.greeks.theta.label}
            small={t.suggestions.greeks.theta.small}
          >
            {thetaSign === 0
              ? t.suggestions.greekSentence.thetaNeutral
              : thetaSign > 0
                ? t.suggestions.greekSentence.thetaPositive(signedPriceBRL(greeks.theta))
                : t.suggestions.greekSentence.thetaNegative(signedPriceBRL(greeks.theta))}
          </Greek>
          <Greek
            color="var(--greek-vega)"
            label={t.suggestions.greeks.vega.label}
            small={t.suggestions.greeks.vega.small}
          >
            {vegaSign === 0
              ? t.suggestions.greekSentence.vegaNeutral
              : vegaSign > 0
                ? t.suggestions.greekSentence.vegaPositive(signedPriceBRL(greeks.vega))
                : t.suggestions.greekSentence.vegaNegative(signedPriceBRL(greeks.vega))}
          </Greek>
          <Greek
            color="var(--greek-delta)"
            label={t.suggestions.greeks.delta.label}
            small={t.suggestions.greeks.delta.small}
          >
            {delta.isZero
              ? t.suggestions.greekSentence.deltaNeutral
              : deltaValue.isPositive()
                ? t.suggestions.greekSentence.deltaBought(delta.text)
                : t.suggestions.greekSentence.deltaSold(delta.text)}
          </Greek>
          <Greek
            color="var(--greek-gamma)"
            label={t.suggestions.greeks.gamma.label}
            small={t.suggestions.greeks.gamma.small}
          >
            {gamma.isZero
              ? t.suggestions.greekSentence.gammaNeutral
              : gammaValue.isPositive()
                ? t.suggestions.greekSentence.gammaPositive(gamma.text)
                : t.suggestions.greekSentence.gammaNegative(gamma.text)}
          </Greek>
        </>
      )}
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
