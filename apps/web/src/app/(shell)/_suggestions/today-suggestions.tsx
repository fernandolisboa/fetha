import Link from "next/link";

import { formatSessionDate } from "@/lib/format/date-time";
import {
  settingsTabHref,
  t as preferencesT,
  type SuggestionArchiveDelay,
} from "@/modules/preferences";
import { getMyTodaySuggestions, suggestionHeadline, t, type SuggestionView } from "@/modules/radar";
import { Panel } from "@/modules/shell";

import { SuggestionList } from "./suggestion-list";

// "Sugestões de hoje" (docs/adr/0067): on the watchlist tab the first `limit` cards with a link
// to the rest; on the radar tab all of them. Once the newest ones are archived (docs/adr/0072)
// the panel says so instead of showing them again. The ones the viewer saw longer ago than
// their chosen delay are listed apart, as links to their pages (docs/adr/0074).
export async function TodaySuggestions({ limit }: { limit?: number }) {
  const today = await getMyTodaySuggestions();
  if (today.kind === "none") return null;
  if (today.kind === "archived") {
    return (
      <Panel title={t.suggestions.title}>
        <p className="text-muted-foreground text-xs text-pretty" data-testid="today-suggestions">
          {t.suggestions.archived(
            formatSessionDate(today.session),
            formatSessionDate(today.openThrough),
          )}
        </p>
      </Panel>
    );
  }

  const { suggestions, archivedSeen, archive } = today;
  const first = suggestions[0] ?? archivedSeen[0];
  if (!first) return null;
  const shown = limit === undefined ? suggestions : suggestions.slice(0, limit);

  return (
    <Panel
      title={t.suggestions.title}
      subtitle={`${t.suggestions.subtitle(formatSessionDate(first.session))} ${t.suggestions.order}`}
    >
      <div className="flex flex-col gap-3" data-testid="today-suggestions">
        {shown.length > 0 ? (
          <SuggestionList suggestions={shown} />
        ) : (
          <p className="text-muted-foreground text-xs text-pretty">
            {t.suggestions.seenArchive.allArchived}
          </p>
        )}
      </div>
      {shown.length < suggestions.length && (
        <Link
          href="/?aba=radar"
          className="text-primary self-start text-xs underline-offset-4 hover:underline"
        >
          {t.suggestions.more(suggestions.length)}
        </Link>
      )}
      {archivedSeen.length > 0 && <ArchivedSeen suggestions={archivedSeen} />}
      <p className="text-muted-foreground text-xs text-pretty">{t.suggestions.footnote}</p>
      <ArchiveSetting archive={archive} />
    </Panel>
  );
}

function ArchivedSeen({ suggestions }: { suggestions: SuggestionView[] }) {
  return (
    <section
      aria-label={t.suggestions.seenArchive.archivedTitle}
      className="flex flex-col gap-1"
      data-testid="archived-seen-suggestions"
    >
      <h3 className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
        {t.suggestions.seenArchive.archivedTitle}
      </h3>
      <ul className="flex flex-col gap-1 text-xs">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id}>
            <Link
              href={`/sugestoes/${suggestion.id}`}
              className="underline-offset-4 hover:underline"
            >
              {suggestionHeadline(suggestion)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArchiveSetting({ archive }: { archive: SuggestionArchiveDelay }) {
  const sentence =
    archive === "off"
      ? t.suggestions.seenArchive.off
      : t.suggestions.seenArchive.on(preferencesT.suggestionArchive.delay[archive]);
  return (
    <p
      className="text-muted-foreground text-xs text-pretty"
      data-testid="suggestion-archive-setting"
    >
      {sentence}{" "}
      <Link
        href={`${settingsTabHref("aparencia")}#sugestoes`}
        className="text-primary underline-offset-4 hover:underline"
      >
        {t.suggestions.seenArchive.adjust}
      </Link>
    </p>
  );
}
