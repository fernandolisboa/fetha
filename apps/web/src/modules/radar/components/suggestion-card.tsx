import type { ReactNode } from "react";
import type { ExpectedMove, ThesisClaim } from "@fetha/contracts";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { AssetReadingChips } from "@/modules/market-data";
import { PayoffChart } from "@/modules/portfolio/client";
import { conditionLines, recipeCards } from "@/modules/recipes";

import type { SuggestionView } from "../suggestion-view";
import { getSuggestionCalibration } from "../queries";
import { gainToRiskRatio, payoffSummarySentence, summarizePayoff } from "../payoff-summary";
import { t } from "../strings";
import { Figure } from "./lot-parts";
import { GreekNotes } from "./greek-notes";
import { LegsTable } from "./legs-table";
import { displayDate, Facts } from "./radar-facts";

export function suggestionHeadline(suggestion: SuggestionView): string {
  return t.suggestions.cardTitle(suggestion.structure.name, suggestion.underlying);
}

function betLabel(expectedMove: ExpectedMove): string {
  switch (expectedMove) {
    case "up":
      return t.suggestions.bet.up;
    case "down":
      return t.suggestions.bet.down;
    case "sideways":
      return t.suggestions.bet.sideways;
    case "big_move":
      return t.suggestions.bet.big_move;
  }
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

// The card's "Por que agora" (docs/adr/0067's redesign): the recipe's own plain-language summary,
// then the exact condition it checked and the readings that matched it today.
function Why({ suggestion }: { suggestion: SuggestionView }) {
  const card = recipeCards().find((entry) => entry.id === suggestion.recipeId);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
        {t.suggestions.whyTitle}
      </p>
      {card && <p className="text-[13px] text-pretty">{card.summary}</p>}
      <p className="text-muted-foreground text-xs">
        {conditionLines(suggestion.recipe.definition.entry)
          .map((line) => line.text)
          .join(" · ")}
      </p>
      {suggestion.reading && <AssetReadingChips reading={suggestion.reading} />}
      <Facts facts={suggestion.facts} />
    </div>
  );
}

async function Details({ suggestion }: { suggestion: SuggestionView }) {
  const calibration = await getSuggestionCalibration().catch(() => null);
  const line =
    calibration?.byRecipe.find((entry) => entry.recipeId === suggestion.recipeId) ?? null;
  return (
    <Collapsible className="border-line-soft border-t pt-2.5">
      <CollapsibleTrigger className="text-primary text-[13px]">
        {t.suggestions.detailsTitle}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <GreekNotes greeks={suggestion.pricing.greeks} calibration={line} />
        <p className="text-muted-foreground text-xs">
          {claimText(suggestion.claim, suggestion.underlying, suggestion.horizon)}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

// One suggestion as the cards and its own page show it (docs/adr/0067): a title, the bet it
// makes and when it expires, one sentence that says what the viewer pays or receives and where
// the profit zone is, three figures, the payoff chart, why the recipe found it, the lot as a
// table, and a closed-by-default "Detalhes" with the greeks and this recipe's own track record.
// Risk check and actions come from the page. On its own page the page header already carries the
// title, so the card leaves it out.
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
  const hasStockLeg = suggestion.legs.some((leg) => leg.role === "stock");
  const summary = summarizePayoff({
    payoff: suggestion.pricing.payoff,
    breakEvens: suggestion.pricing.breakEvens,
    netPremium: suggestion.pricing.netPremium,
    maxGain: suggestion.pricing.maxGain,
    maxLoss: suggestion.maxLoss,
  });
  const sentence = payoffSummarySentence(summary, {
    ticker: suggestion.underlying,
    date: displayDate(suggestion.horizon),
    hasStockLeg,
  });

  return (
    <article
      className="@container flex flex-col gap-3"
      data-testid="suggestion-card"
      aria-label={suggestionHeadline(suggestion)}
    >
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-[11px]">
          {t.suggestions.eyebrow(
            displayDate(suggestion.session),
            suggestion.recipe.definition.name,
          )}
        </p>
        {headline && <h3 className="text-[15px] font-medium">{suggestionHeadline(suggestion)}</h3>}
        <ul className="mt-1 flex flex-wrap gap-1.5">
          <li>
            <Badge
              variant="outline"
              style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
            >
              {betLabel(suggestion.recipe.expectedMove)}
            </Badge>
          </li>
          <li>
            <Badge variant="secondary" className="font-mono tabular-nums">
              {t.suggestions.expiresChip(displayDate(suggestion.horizon))}
            </Badge>
          </li>
          <li>
            <Badge variant="secondary">
              {summary.isDebit ? t.suggestions.debitChip : t.suggestions.creditChip}
            </Badge>
          </li>
        </ul>
      </header>
      <div className="flex flex-col gap-3 @min-[44rem]:grid @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @min-[44rem]:gap-x-6 @min-[44rem]:gap-y-4 @min-[44rem]:[grid-template-areas:'lead_chart'_'why_chart'_'legs_chart']">
        <div className="@container flex min-w-0 flex-col gap-3 @min-[44rem]:[grid-area:lead]">
          <p className="text-[15px] text-pretty">{sentence}</p>
          <dl
            aria-label={t.suggestions.numbersLabel}
            className="grid grid-cols-2 gap-x-6 gap-y-2 @min-[26rem]:grid-cols-4"
          >
            <Figure
              label={t.suggestions.figures.risked}
              value={formatBRL(suggestion.maxLoss)}
              hint={t.suggestions.figures.riskedHint}
            />
            <Figure
              label={t.suggestions.figures.gainUpTo}
              value={
                suggestion.pricing.maxGain === "unbounded"
                  ? t.suggestions.figures.gainUnbounded
                  : formatBRL(suggestion.pricing.maxGain)
              }
              token="--up"
            />
            <Figure
              label={t.suggestions.figures.gainToRisk}
              value={gainToRiskRatio(suggestion.pricing.maxGain, suggestion.maxLoss)}
              hint={t.suggestions.figures.gainToRiskHint}
            />
          </dl>
        </div>
        <div className="min-w-0 @min-[44rem]:[grid-area:chart]">
          <PayoffChart
            points={suggestion.pricing.payoff}
            pointsNow={suggestion.pricing.payoffNow}
            spot={suggestion.pricing.spot}
            breakEvens={suggestion.pricing.breakEvens}
            maxGain={suggestion.pricing.maxGain}
            maxLoss={suggestion.maxLoss}
            spotLabel={t.suggestions.chartSpot(formatPriceBRL(suggestion.pricing.spot))}
            framed
          />
        </div>
        <div className="min-w-0 @min-[44rem]:[grid-area:why]">
          <Why suggestion={suggestion} />
        </div>
        <div className="min-w-0 @min-[44rem]:[grid-area:legs]">
          <LegsTable legs={suggestion.legs} />
        </div>
      </div>
      <Details suggestion={suggestion} />
      {risk}
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </article>
  );
}
