import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatSessionDate } from "@/lib/format/date-time";
import { AssetReadingChips } from "@/modules/market-data/client";
import { RiskNotice } from "@/modules/portfolio/client";

import type { Idea } from "../research";
import type { IdeaAlert } from "../research-rules";
import { t } from "../strings";
import { Figure, lotLegText, netPremiumText } from "./lot-parts";

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
      <RiskNotice breaches={breaches} />
    </>
  );
}

// One re-checked idea (docs/adr/0075): the lot re-priced at the newest close, its alerts, and a
// way back to the suggestion it came from and to the asset. No decision bar yet: a research is
// not stored, so its ideas have no id to decide on.
export function ResearchIdeaCard({ idea }: { idea: Idea }) {
  const title = t.research.cardTitle(idea.structure.name, idea.underlying);
  const labels = t.suggestions.numbers;
  return (
    <article
      className="border-border flex flex-col gap-3 rounded-[var(--radius)] border p-3"
      data-testid="research-idea"
      aria-label={title}
    >
      <h4 className="text-[15px] font-medium">{title}</h4>
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-xs">
          {t.research.foundOn(formatSessionDate(idea.foundOn))}
        </p>
        <AssetReadingChips reading={idea.reading} />
      </div>
      <IdeaAlerts alerts={idea.alerts} />
      <ul aria-label={t.suggestions.legsLabel} className="font-mono text-xs tabular-nums">
        {idea.legs.map((leg) => (
          <li key={`${leg.side}-${leg.ticker}`}>{lotLegText(leg)}</li>
        ))}
      </ul>
      <dl
        aria-label={t.suggestions.numbersLabel}
        className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4"
      >
        <Figure label={labels.netPremium} value={netPremiumText(idea.netPremium)} />
        <Figure label={labels.maxLoss} value={formatBRL(idea.maxLoss)} />
        <Figure
          label={labels.maxGain}
          value={idea.maxGain === "unbounded" ? labels.unbounded : formatBRL(idea.maxGain)}
        />
        <Figure
          label={labels.breakEvens}
          value={
            idea.breakEvens.length > 0
              ? idea.breakEvens.map((value) => formatPriceBRL(value)).join(" / ")
              : "—"
          }
        />
      </dl>
      <p className="text-[13px]">
        {t.research.expires(formatSessionDate(idea.expiry), idea.sessionsToExpiry)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {idea.suggestionId && (
          <Link
            href={`/sugestoes/${idea.suggestionId}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t.research.actions.suggestion}
          </Link>
        )}
        <Link
          href={`/ativos/${idea.underlying}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t.research.actions.asset}
        </Link>
      </div>
    </article>
  );
}
