import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { ExpectedMove, ThesisClaim } from "@fetha/contracts";
import type { LegValuation } from "@fetha/engine";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatPriceBRL } from "@/lib/format/brl";
import { AssetReadingChips } from "@/modules/market-data";
import { PayoffChart } from "@/modules/portfolio/client";
import { conditionLines, recipeSummary, type RuleLine } from "@/modules/recipes";

import type { CalibrationLine } from "../calibration";
import type { SuggestionView } from "../suggestion-view";
import { getSuggestionCalibration } from "../queries";
import {
  payoffSummarySentence,
  premiumChipKind,
  summarizePayoff,
  type PremiumChipKind,
} from "../payoff-summary";
import { t } from "../strings";
import { PayoffFigures } from "./lot-parts";
import { GreekNotes } from "./greek-notes";
import { LegsTable } from "./legs-table";
import { displayDate, observeOperand } from "./radar-facts";

export function suggestionHeadline(suggestion: SuggestionView): string {
  return t.suggestions.cardTitle(suggestion.structure.name, suggestion.underlying);
}

export function scenarioLabel(expectedMove: ExpectedMove): string {
  switch (expectedMove) {
    case "up":
      return t.suggestions.scenario.up;
    case "down":
      return t.suggestions.scenario.down;
    case "sideways":
      return t.suggestions.scenario.sideways;
    case "big_move":
      return t.suggestions.scenario.big_move;
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

// Pairs each condition with the figure that actually matched it today. A genuinely flat
// top-level "and" (or a single condition) reads as one joined line; anything with its own
// connective (or/not, or an "and" nested under one of those) keeps the indented rendering so the
// connective is not lost (review finding #10).
function ConditionLines({ lines }: { lines: RuleLine[] }) {
  if (lines.every((line) => line.depth === 0)) {
    return (
      <p className="text-muted-foreground text-xs">{lines.map((line) => line.text).join(" · ")}</p>
    );
  }
  return (
    <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
      {lines.map((line, index) => (
        <li key={index} style={{ marginLeft: `${String(line.depth * 12)}px` }}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}

// The card's "Por que agora" (docs/adr/0067, amended 2026-11-21): the recipe's own plain-language
// summary, then the exact condition it checked paired with what it read today.
function Why({ suggestion }: { suggestion: SuggestionView }) {
  const summary = recipeSummary(suggestion.recipeId);
  const lines = conditionLines(suggestion.recipe.definition.entry, 0, (operand) =>
    observeOperand(operand, suggestion.facts),
  );
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
        {t.suggestions.whyTitle}
      </p>
      {summary && <p className="text-[13px] text-pretty">{summary}</p>}
      <ConditionLines lines={lines} />
      {suggestion.reading && <AssetReadingChips reading={suggestion.reading} />}
    </div>
  );
}

// The closed-by-default "Detalhes" disclosure's sync half: the greeks, the recipe's own
// calibration and the thesis claim, once the async half below has fetched that calibration.
// Kept apart so it, and the chevron that marks it open, can be unit-tested without a server
// round trip (review round 2, finding #8). The chevron keys off the Collapsible root's own
// `data-open`/`data-closed` (round 2 finding #1): `data-panel-open` lands on the trigger itself,
// never on the ancestor the `group/details` class sits on, so a selector built from it can never
// match.
export function SuggestionDetails({
  greeks,
  legs,
  calibration,
  claim,
  underlying,
  horizon,
  defaultOpen = false,
}: {
  greeks: SuggestionView["pricing"]["greeks"];
  legs: readonly LegValuation[];
  calibration: CalibrationLine | null;
  claim: ThesisClaim;
  underlying: string;
  horizon: string;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group/details border-line-soft border-t pt-2.5"
    >
      <CollapsibleTrigger className="text-primary flex items-center gap-1 text-[13px]">
        {t.suggestions.detailsTitle}
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-data-open/details:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <GreekNotes greeks={greeks} legs={legs} calibration={calibration} />
        <p className="text-muted-foreground text-xs">{claimText(claim, underlying, horizon)}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

async function Details({ suggestion }: { suggestion: SuggestionView }) {
  const calibration = await getSuggestionCalibration().catch(() => null);
  const line =
    calibration?.byRecipe.find((entry) => entry.recipeId === suggestion.recipeId) ?? null;
  return (
    <SuggestionDetails
      greeks={suggestion.pricing.greeks}
      legs={suggestion.pricing.legs}
      calibration={line}
      claim={suggestion.claim}
      underlying={suggestion.underlying}
      horizon={suggestion.horizon}
    />
  );
}

// The card's own title, scenario chip, expiry chip and premium chip (sync, review round 2
// finding #8): kept apart from `SuggestionCard` so it can be unit-tested on its own.
export function SuggestionCardHeader({
  suggestion,
  headline,
  chipKind,
}: {
  suggestion: SuggestionView;
  headline: boolean;
  chipKind: PremiumChipKind;
}) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-muted-foreground text-[11px]">
        {t.suggestions.eyebrow(displayDate(suggestion.session), suggestion.recipe.definition.name)}
      </p>
      {headline && <h3 className="text-[15px] font-medium">{suggestionHeadline(suggestion)}</h3>}
      <ul className="mt-1 flex flex-wrap gap-1.5">
        <li>
          <Badge variant="outline" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
            {scenarioLabel(suggestion.recipe.expectedMove)}
          </Badge>
        </li>
        <li>
          <Badge variant="secondary" className="font-mono tabular-nums">
            {t.suggestions.expiresChip(displayDate(suggestion.horizon))}
          </Badge>
        </li>
        {chipKind && (
          <li>
            <Badge variant="secondary">
              {chipKind === "debit" ? t.suggestions.debitChip : t.suggestions.creditChip}
            </Badge>
          </li>
        )}
      </ul>
    </header>
  );
}

// One suggestion as the cards and its own page show it (docs/adr/0067, amended 2026-11-21): a
// title, the scenario it needs and when it expires, one sentence that says what the viewer pays
// or receives and where the profit zone is, three figures, the payoff chart, why the recipe
// found it, the lot as a table, and a closed-by-default "Detalhes" with the greeks and this
// recipe's own track record. Risk check and actions come from the page. On its own page the page
// header already carries the title, so the card leaves it out.
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
  const chipKind = premiumChipKind(summary);

  return (
    <article
      className="@container flex flex-col gap-3"
      data-testid="suggestion-card"
      aria-label={suggestionHeadline(suggestion)}
    >
      <SuggestionCardHeader suggestion={suggestion} headline={headline} chipKind={chipKind} />
      <div className="flex flex-col gap-3 @min-[44rem]:grid @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @min-[44rem]:gap-x-6 @min-[44rem]:gap-y-4 @min-[44rem]:[grid-template-areas:'lead_chart'_'why_chart'_'legs_chart']">
        <div className="@container flex min-w-0 flex-col gap-3 @min-[44rem]:[grid-area:lead]">
          <p className="text-[15px] text-pretty">{sentence}</p>
          <PayoffFigures maxLoss={suggestion.maxLoss} maxGain={suggestion.pricing.maxGain} />
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
