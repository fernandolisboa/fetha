import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { filingTones, type FilingTone } from "@fetha/contracts";
import { Decimal } from "decimal.js";

import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { cn } from "@/lib/utils";
import { sessionDateToDisplayDate } from "@/modules/market-data";

import type { SentimentView } from "../queries";
import { t } from "../strings";

import { NewsToneChart } from "./news-tone-chart";

const toneClass: Record<FilingTone, string> = {
  positive: "text-up",
  neutral: "text-muted-foreground",
  negative: "text-down",
};

function displayDay(day: string): string {
  return formatDate(sessionDateToDisplayDate(day));
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-line-soft flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[11px] font-normal", className)}>
      {children}
    </Badge>
  );
}

function FilingsSection({ view }: { view: SentimentView }) {
  const strings = t.filings;
  const { filings } = view;
  if (!view.mapped) {
    return (
      <Section title={strings.title}>
        <Note>{strings.notACompany}</Note>
      </Section>
    );
  }
  if (!filings.enabled) {
    return (
      <Section title={strings.title}>
        <Note>{strings.off}</Note>
      </Section>
    );
  }
  return (
    <Section title={strings.title}>
      {filings.labelled > 0 ? (
        <ul className="flex flex-wrap gap-x-3 text-[13px]" aria-label={strings.countsLabel}>
          {filingTones.map((tone) => (
            <li key={tone} className={toneClass[tone]}>
              <span className="font-mono tabular-nums">{String(filings.counts[tone])}</span>{" "}
              {strings.count[tone](filings.counts[tone])}
            </li>
          ))}
        </ul>
      ) : (
        <Note>{strings.none}</Note>
      )}
      {filings.latest.length > 0 && (
        <ul className="flex flex-col gap-3">
          {filings.latest.map((filing) => (
            <li key={filing.protocol} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {displayDay(filing.deliveredOn)}
                </span>
                <Chip>{strings.topic[filing.topic]}</Chip>
                <Chip className={toneClass[filing.tone]}>{strings.tone[filing.tone]}</Chip>
              </div>
              <a
                href={filing.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary inline-flex items-start gap-1 text-[13px] underline-offset-4 hover:underline"
                aria-label={`${filing.summary} ${strings.openDocument(strings.topic[filing.topic])}`}
              >
                <span>{filing.summary}</span>
                <ExternalLink aria-hidden className="mt-1 size-3 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {filings.waiting > 0 && <Note>{strings.waiting(filings.waiting)}</Note>}
      {filings.unlabelled > 0 && <Note>{strings.unlabelled(filings.unlabelled)}</Note>}
      <Note>{strings.explainer}</Note>
    </Section>
  );
}

function newsStatusNote(view: SentimentView): string | null {
  const strings = t.news;
  switch (view.newsTone.status) {
    case null:
      return strings.notYet;
    case "rate_limited":
      return strings.rateLimited;
    case "failed":
      return strings.failed;
    case "ok":
      return null;
  }
}

function NewsSection({ view }: { view: SentimentView }) {
  const strings = t.news;
  if (!view.mapped) {
    return null;
  }
  const { newsTone } = view;
  const statusNote = newsStatusNote(view);
  const plotted = newsTone.points.filter((point) => point.articles > 0);
  const fetchedOn = newsTone.fetchedAt ? formatDate(newsTone.fetchedAt) : null;
  return (
    <Section title={strings.title}>
      {plotted.length > 1 && <NewsToneChart points={newsTone.points} label={strings.chartLabel} />}
      {newsTone.average ? (
        <p className="text-[13px]">
          {strings.average(formatDecimal(newsTone.average.tone), newsTone.average.articles)}
        </p>
      ) : (
        newsTone.status === "ok" && <Note>{strings.noArticles}</Note>
      )}
      {statusNote && <Note>{statusNote}</Note>}
      <Note>{strings.explainer}</Note>
      {newsTone.query && <Note>{strings.query(newsTone.query)}</Note>}
      {fetchedOn && <Note>{strings.fetchedOn(fetchedOn)}</Note>}
      <Note>{strings.attribution}</Note>
    </Section>
  );
}

function sentimentWord(score: string): keyof typeof t.provider.sentiment {
  const value = new Decimal(score);
  if (value.isZero()) {
    return "neutral";
  }
  return value.isPositive() ? "positive" : "negative";
}

function ProviderSection({ view }: { view: SentimentView }) {
  const strings = t.provider;
  if (!view.provider.enabled && view.provider.articles.length === 0) {
    return null;
  }
  return (
    <Section title={strings.title}>
      {view.provider.articles.length === 0 ? (
        <Note>{strings.none}</Note>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.provider.articles.map((article) => {
            const word = sentimentWord(article.sentiment);
            return (
              <li
                key={`${article.provider}:${article.articleId}`}
                className="flex flex-col gap-0.5"
              >
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary inline-flex items-start gap-1 text-[13px] underline-offset-4 hover:underline"
                  aria-label={strings.openArticle(article.title)}
                >
                  <span className="line-clamp-2">{article.title}</span>
                  <ExternalLink aria-hidden className="mt-1 size-3 shrink-0" />
                </a>
                <p className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                  <span className="font-mono tabular-nums">{formatDate(article.publishedAt)}</span>
                  <span>{article.source}</span>
                  <span className={cn("font-mono tabular-nums", toneClass[word])}>
                    {strings.sentiment[word]} {formatDecimal(article.sentiment)}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <Note>{strings.attribution}</Note>
    </Section>
  );
}

export function SentimentPanel({
  view,
  onWatchlist,
}: {
  view: SentimentView;
  onWatchlist: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {!onWatchlist && <Note>{t.panel.notWatched}</Note>}
      <FilingsSection view={view} />
      <NewsSection view={view} />
      <ProviderSection view={view} />
    </div>
  );
}
