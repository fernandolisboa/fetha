import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tickerSchema } from "@fetha/contracts";

import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format/date-time";
import { requireUser } from "@/modules/auth";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { getSuggestion, SuggestionNotFoundError, suggestionHeadline, t } from "@/modules/radar";
import { RecipeRule, RecipeTest } from "@/modules/recipes";
import { PageHeader, Panel, t as shellStrings } from "@/modules/shell";

import { SuggestionList } from "../../_suggestions/suggestion-list";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.watchlist}` };

export default async function SuggestionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const suggestion = await getSuggestion(id).catch((error: unknown) => {
    if (error instanceof SuggestionNotFoundError) return null;
    throw error;
  });
  if (!suggestion) notFound();

  return (
    <div className="flex flex-col gap-6 px-5 py-8">
      <PageHeader
        overline={t.page.overline(formatDate(sessionDateToDisplayDate(suggestion.session)))}
        headline={suggestionHeadline(suggestion)}
      />
      <ul className="flex flex-wrap gap-2">
        <li>
          <Badge variant="secondary">{suggestion.structure.name}</Badge>
        </li>
        <li>
          <Badge variant="secondary" className="font-mono tabular-nums">
            {t.page.expires(formatDate(sessionDateToDisplayDate(suggestion.horizon)))}
          </Badge>
        </li>
        <li>
          <Badge variant="secondary" className="font-mono tabular-nums">
            {(suggestion.window.archived ? t.page.archived : t.page.openThrough)(
              formatDate(sessionDateToDisplayDate(suggestion.window.openThrough)),
            )}
          </Badge>
        </li>
        <li>
          <Badge variant="secondary">{t.page.lot}</Badge>
        </li>
      </ul>
      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-[14px]">
          <Panel>
            <SuggestionList suggestions={[suggestion]} onPage />
            <p className="text-muted-foreground text-xs text-pretty">{t.suggestions.footnote}</p>
          </Panel>
          <Panel>
            <RecipeTest
              recipeId={suggestion.recipeId}
              ticker={tickerSchema.parse(suggestion.underlying)}
            />
          </Panel>
        </div>
        <div className="flex flex-col gap-[14px]">
          <RecipeRule recipeId={suggestion.recipeId} />
          <Panel title={t.page.notesTitle}>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-pretty">
              {t.page.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
