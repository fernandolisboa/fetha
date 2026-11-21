import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatBRL } from "@/lib/format/brl";
import { cn } from "@/lib/utils";

import type { SuggestionView } from "../suggestion-view";
import { profitZoneText, summarizePayoff } from "../payoff-summary";
import { t } from "../strings";
import { PayoffSparkline } from "./payoff-sparkline";
import { scenarioLabel, suggestionHeadline, SuggestionCard } from "./suggestion-card";
import { displayDate } from "./radar-facts";

// Card B (ticket: compact suggestions, docs/adr/0067 amendment): one line per suggestion for
// sweeping a long list, built from exactly the same engine-computed numbers the full card reads
// (`summarizePayoff`); opening the row mounts card A inline below it rather than a second
// rendering of its own. Collapsed by default, and never used on the suggestion's own page.
export function SuggestionRow({
  suggestion,
  risk,
  actions,
}: {
  suggestion: SuggestionView;
  risk: ReactNode;
  actions: ReactNode;
}) {
  const summary = summarizePayoff({
    payoff: suggestion.pricing.payoff,
    breakEvens: suggestion.pricing.breakEvens,
    netPremium: suggestion.pricing.netPremium,
    maxGain: suggestion.pricing.maxGain,
    maxLoss: suggestion.maxLoss,
  });
  const zoneText = profitZoneText(summary.zone);
  const gainText =
    suggestion.pricing.maxGain === "unbounded"
      ? t.suggestions.compactRow.gainUnbounded
      : formatBRL(suggestion.pricing.maxGain);
  const expiresText = t.suggestions.compactRow.expiresAt(displayDate(suggestion.horizon));
  const title = suggestionHeadline(suggestion);

  return (
    <Collapsible className="border-line-soft @container border-b last:border-b-0">
      <CollapsibleTrigger
        aria-label={title}
        className={cn(
          "group hover:bg-secondary/40 grid w-full items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left",
          "grid-cols-[minmax(0,1fr)_96px] [grid-template-areas:'t_spark'_'n_spark'_'z_spark']",
          "@min-[44rem]:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_120px_72px]",
          "@min-[44rem]:[grid-template-areas:'t_n_z_spark_open']",
        )}
      >
        <span className="flex flex-wrap items-baseline gap-2 text-[13px] font-medium [grid-area:t]">
          {title}
          <Badge variant="outline" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
            {scenarioLabel(suggestion.recipe.expectedMove)}
          </Badge>
        </span>
        <span className="text-muted-foreground text-xs [grid-area:n]">
          {t.suggestions.compactRow.risked}{" "}
          <b className="text-foreground font-mono tabular-nums">{formatBRL(suggestion.maxLoss)}</b>
          {" · "}
          {t.suggestions.compactRow.gainUpTo}{" "}
          <b className="font-mono tabular-nums" style={{ color: "var(--up)" }}>
            {gainText}
          </b>
        </span>
        <span className="text-muted-foreground text-xs [grid-area:z]">
          {zoneText ? `${zoneText} · ${expiresText}` : expiresText}
        </span>
        <span className="w-24 justify-self-end [grid-area:spark] @min-[44rem]:w-[120px]">
          <PayoffSparkline payoff={suggestion.pricing.payoff} ticker={suggestion.underlying} />
        </span>
        <span
          className={cn(
            "text-primary hidden items-center justify-end gap-1 text-xs [grid-area:open]",
            "@min-[44rem]:flex",
          )}
        >
          <span className="group-data-[panel-open]:hidden">{t.suggestions.compactRow.open}</span>
          <span className="hidden group-data-[panel-open]:inline">
            {t.suggestions.compactRow.close}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 transition-transform group-data-[panel-open]:rotate-180"
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3">
          <SuggestionCard suggestion={suggestion} risk={risk} actions={actions} headline={false} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
