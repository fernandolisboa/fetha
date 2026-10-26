import Link from "next/link";

import { formatSessionDate } from "@/lib/format/date-time";
import { getTodaySuggestions, t } from "@/modules/radar";
import { SuggestionResearch } from "@/modules/radar/client";
import { Panel } from "@/modules/shell";

import { SuggestionList } from "./suggestion-list";

// "Sugestões de hoje" (docs/adr/0067): on the watchlist tab the first `limit` cards with a link
// to the rest; on the radar tab all of them. They stay until the radar reads a newer close, with
// a note when that close is overdue (docs/adr/0073).
export async function TodaySuggestions({ limit }: { limit?: number }) {
  const today = await getTodaySuggestions();
  if (today.kind === "none") {
    return (
      <Panel title={t.suggestions.title}>
        <p className="text-muted-foreground text-xs text-pretty" data-testid="today-suggestions">
          {t.suggestions.none}
        </p>
        <SuggestionResearch />
      </Panel>
    );
  }

  const { suggestions, session, overdueSessions } = today;
  const shown = limit === undefined ? suggestions : suggestions.slice(0, limit);

  return (
    <Panel
      title={t.suggestions.title}
      subtitle={`${t.suggestions.subtitle(formatSessionDate(session))} ${t.suggestions.order}`}
    >
      {overdueSessions > 0 && (
        <p className="text-warning text-xs text-pretty" data-testid="today-suggestions-overdue">
          {t.suggestions.overdue(overdueSessions)}
        </p>
      )}
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
      <SuggestionResearch />
    </Panel>
  );
}
