import type { ReactNode } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPriceBRL } from "@/lib/format/brl";
import { cn } from "@/lib/utils";
import { formatSessionDate } from "@/lib/format/date-time";
import { StructureLessonLink } from "@/modules/learning/client";
import { AssetReadingChips } from "@/modules/market-data/client";
import { PayoffChart, RiskNotice } from "@/modules/portfolio/client";

import type { IdeaCard } from "../research";
import type { IdeaAlert } from "../research-rules";
import { payoffSummarySentence, summarizePayoff } from "../payoff-summary";
import { t } from "../strings";
import { PayoffFigures } from "./lot-parts";
import { LegsTable } from "./legs-table";

function alertText(alert: Exclude<IdeaAlert, { kind: "limit_breach" }>): string {
  switch (alert.kind) {
    case "rule_no_longer_holds":
      return t.research.alerts.rule_no_longer_holds(formatSessionDate(alert.foundOn));
    case "near_expiry":
      return t.research.alerts.near_expiry(alert.sessionsLeft);
  }
}

function IdeaAlerts({ alerts }: { alerts: readonly IdeaAlert[] }) {
  const notices = alerts.flatMap((alert) => (alert.kind === "limit_breach" ? [] : [alert]));
  const breaches = alerts.flatMap((alert) => (alert.kind === "limit_breach" ? [alert.breach] : []));
  return (
    <>
      {notices.length > 0 && (
        <ul aria-label={t.research.alertsLabel} className="flex flex-col gap-1">
          {notices.map((alert) => (
            <li
              key={alert.kind}
              className="flex items-start gap-1.5 text-[13px] text-pretty"
              style={{ color: "var(--warning)" }}
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {alertText(alert)}
            </li>
          ))}
        </ul>
      )}
      <RiskNotice breaches={breaches} announce={false} />
    </>
  );
}

// One re-checked idea (docs/adr/0075): the lot re-priced at the newest close, its alerts, and a
// way back to the suggestion it came from and to the asset. `title` replaces the engine's plain
// headline with Fetha's voice, `opinion` sits right under it and `actions` follow the links; a
// stored idea gets all three (docs/adr/0076), an engine-only one none.
export function ResearchIdeaCard({
  idea,
  stale = false,
  title: voicedTitle,
  opinion,
  actions,
}: {
  idea: IdeaCard;
  stale?: boolean;
  title?: string;
  opinion?: ReactNode;
  actions?: ReactNode;
}) {
  const title = voicedTitle ?? t.research.cardTitle(idea.structure.name, idea.underlying);
  const hasStockLeg = idea.legs.some((leg) => leg.role === "stock");
  const summary = summarizePayoff({
    payoff: idea.chart.payoff,
    breakEvens: idea.breakEvens,
    netPremium: idea.netPremium,
    maxGain: idea.maxGain,
    maxLoss: idea.maxLoss,
  });
  const sentence = payoffSummarySentence(summary, {
    ticker: idea.underlying,
    date: formatSessionDate(idea.expiry),
    hasStockLeg,
  });

  return (
    <article
      className={cn(
        "border-border @container flex min-w-0 flex-col gap-3 rounded-[var(--radius)] border p-3",
        stale && "border-l-[3px]",
      )}
      style={stale ? { borderLeftColor: "var(--warning)" } : undefined}
      data-testid="research-idea"
      aria-label={title}
    >
      <h4 className="text-[13px] font-semibold">{title}</h4>
      <Badge variant="secondary" className="w-fit font-mono tabular-nums">
        {t.research.expires(formatSessionDate(idea.expiry), idea.sessionsToExpiry)}
      </Badge>
      <StructureLessonLink href={idea.lessonHref} name={idea.structure.name} />
      {opinion}
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-xs">
          {t.research.foundOn(formatSessionDate(idea.foundOn))}
        </p>
        <AssetReadingChips reading={idea.reading} />
      </div>
      <IdeaAlerts alerts={idea.alerts} />
      <p className={cn("text-[13px] text-pretty", stale && "opacity-75")}>{sentence}</p>
      <PayoffFigures
        maxLoss={idea.maxLoss}
        maxGain={idea.maxGain}
        probabilityOfProfit={idea.probabilityOfProfit}
        className={cn(
          "grid grid-cols-2 gap-x-6 gap-y-2 @min-[26rem]:grid-cols-4",
          stale && "opacity-75",
        )}
      />
      <LegsTable legs={idea.legs} />
      <PayoffChart
        points={idea.chart.payoff}
        spot={idea.chart.spot}
        breakEvens={idea.breakEvens}
        maxGain={idea.maxGain}
        maxLoss={idea.maxLoss}
        spotLabel={t.suggestions.chartSpot(formatPriceBRL(idea.chart.spot))}
        framed
      />
      <div className="flex flex-wrap items-center gap-2">
        {idea.suggestionId && (
          <Link
            href={`/sugestoes/${idea.suggestionId}`}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "max-md:min-h-11",
            })}
          >
            {t.research.actions.suggestion}
          </Link>
        )}
        <Link
          href={`/ativos/${idea.underlying}`}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "max-md:min-h-11" })}
        >
          {t.research.actions.asset}
        </Link>
        {actions}
      </div>
    </article>
  );
}
