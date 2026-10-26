import Link from "next/link";

import { formatDate } from "@/lib/format/date-time";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { getTodaySuggestions, t } from "@/modules/radar";
import { Panel } from "@/modules/shell";

import { SuggestionList } from "./suggestion-list";

const displayDate = (session: string) => formatDate(sessionDateToDisplayDate(session));

// "Sugestões de hoje" (docs/adr/0067): on the watchlist tab the first `limit` cards with a link
// to the rest; on the radar tab all of them. Once the newest ones are archived (docs/adr/0072)
// the panel says so instead of showing them again.
export async function TodaySuggestions({ limit }: { limit?: number }) {
  const today = await getTodaySuggestions();
  switch (today.kind) {
    case "none":
      return null;
    case "archived":
      return (
        <Panel title={t.suggestions.title}>
          <p className="text-muted-foreground text-xs text-pretty" data-testid="today-suggestions">
            {t.suggestions.archived(displayDate(today.session), displayDate(today.openThrough))}
          </p>
        </Panel>
      );
    case "open":
      break;
  }

  const { suggestions } = today;
  const [first] = suggestions;
  if (!first) return null;
  const shown = limit === undefined ? suggestions : suggestions.slice(0, limit);

  return (
    <Panel
      title={t.suggestions.title}
      subtitle={`${t.suggestions.subtitle(displayDate(first.session))} ${t.suggestions.order}`}
    >
      <div className="flex flex-col gap-3" data-testid="today-suggestions">
        <SuggestionList suggestions={shown} />
      </div>
      {shown.length < suggestions.length && (
        <Link
          href="/?aba=radar"
          className="text-primary self-start text-xs underline-offset-4 hover:underline"
        >
          {t.suggestions.more(suggestions.length)}
        </Link>
      )}
      <p className="text-muted-foreground text-xs text-pretty">{t.suggestions.footnote}</p>
    </Panel>
  );
}
