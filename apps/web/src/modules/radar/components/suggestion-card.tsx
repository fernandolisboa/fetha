import type { ReactNode } from "react";
import { decimalStringSchema, type Centavos, type ThesisClaim } from "@fetha/contracts";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";
import { AssetReadingChips } from "@/modules/market-data";

import type { SuggestionView } from "../suggestion-view";
import { t } from "../strings";
import { displayDate, Facts, legText } from "./radar-facts";

export function suggestionHeadline(suggestion: SuggestionView): string {
  const headlines: Partial<Record<string, (ticker: string) => string>> = t.suggestions.headline;
  const headline = headlines[suggestion.recipeId];
  return headline
    ? headline(suggestion.underlying)
    : t.suggestions.fallbackHeadline(suggestion.structure.name, suggestion.underlying);
}

function claimText(claim: ThesisClaim, underlying: string, horizon: string): string {
  const date = displayDate(horizon);
  switch (claim.kind) {
    case "close_above":
    case "close_below":
      return t.suggestions.claim[claim.kind](underlying, formatPriceBRL(claim.level), date);
    case "operation_pnl_positive":
      return t.suggestions.claim.operation_pnl_positive(date);
  }
}

function lotLegText(leg: SuggestionView["legs"][number]): string {
  const quantity = formatDecimal(decimalStringSchema.parse(String(leg.quantity)), 0);
  return `${quantity} × ${legText(leg)} · ${t.suggestions.legPrice(formatPriceBRL(leg.price))}`;
}

// DESIGN.md's money convention, as the builder's StatBlocks: a credit reads "+ R$".
function netPremiumText(value: Centavos): string {
  return value > 0 ? `+ ${formatBRL(value)}` : formatBRL(value);
}

function Figure({ label, value, token }: { label: string; value: string; token?: string }) {
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

export function SuggestionNumbers({ suggestion }: { suggestion: SuggestionView }) {
  const { pricing } = suggestion;
  const labels = t.suggestions.numbers;
  return (
    <dl
      aria-label={t.suggestions.numbersLabel}
      className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4"
    >
      <Figure label={labels.netPremium} value={netPremiumText(pricing.netPremium)} />
      <Figure label={labels.maxLoss} value={formatBRL(suggestion.maxLoss)} />
      <Figure
        label={labels.maxGain}
        value={pricing.maxGain === "unbounded" ? labels.unbounded : formatBRL(pricing.maxGain)}
      />
      <Figure
        label={labels.breakEvens}
        value={
          pricing.breakEvens.length > 0
            ? pricing.breakEvens.map((value) => formatPriceBRL(value)).join(" / ")
            : "—"
        }
      />
      <Figure
        label={labels.delta}
        value={formatDecimal(pricing.greeks.delta, 0)}
        token="--greek-delta"
      />
      <Figure
        label={labels.gamma}
        value={formatDecimal(pricing.greeks.gamma, 0)}
        token="--greek-gamma"
      />
      <Figure
        label={labels.theta}
        value={formatPriceBRL(pricing.greeks.theta)}
        token="--greek-theta"
      />
      <Figure
        label={labels.vega}
        value={formatPriceBRL(pricing.greeks.vega)}
        token="--greek-vega"
      />
    </dl>
  );
}

// One suggestion as the cards and its own page show it (docs/adr/0067): the direct-voice line,
// the readings that triggered it, the lot the engine priced and its numbers, the thesis it is
// scored on, then the viewer's own risk check and actions, which the page supplies. On its own
// page the page header already speaks the line, so the card leaves it out.
export function SuggestionCard({
  suggestion,
  risk,
  actions,
  headline = true,
}: {
  suggestion: SuggestionView;
  risk: ReactNode;
  actions: ReactNode;
  headline?: boolean;
}) {
  return (
    <article
      className="flex flex-col gap-3"
      data-testid="suggestion-card"
      aria-label={suggestionHeadline(suggestion)}
    >
      {headline && <h3 className="text-[15px] font-medium">{suggestionHeadline(suggestion)}</h3>}
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-xs">
          {t.suggestions.why(suggestion.recipe.definition.name)}
        </p>
        {suggestion.reading && <AssetReadingChips reading={suggestion.reading} />}
        <Facts facts={suggestion.facts} />
      </div>
      <ul aria-label={t.suggestions.legsLabel} className="font-mono text-xs tabular-nums">
        {suggestion.legs.map((leg) => (
          <li key={`${leg.side}-${leg.ticker}`}>{lotLegText(leg)}</li>
        ))}
      </ul>
      <SuggestionNumbers suggestion={suggestion} />
      <p className="text-[13px]">
        {claimText(suggestion.claim, suggestion.underlying, suggestion.horizon)}
      </p>
      {risk}
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </article>
  );
}
