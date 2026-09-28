"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandStatus,
} from "@/components/ui/command";
import { deriveSearchMessage, deriveSearchStatusText } from "@/lib/search-status";

import {
  instrumentHref,
  mergeSearchOutcomes,
  strategyHref,
  type InstrumentSearchFn,
  type InstrumentSearchHit,
  type StrategySearchFn,
  type StrategySearchHit,
} from "../search";
import { t } from "../strings";

const SEARCH_DEBOUNCE_MS = 200;

type SearchOutcome =
  | {
      query: string;
      kind: "ok";
      instruments: InstrumentSearchHit[];
      strategies: StrategySearchHit[];
      throttled: boolean;
    }
  | { query: string; kind: "rate_limited" }
  | { query: string; kind: "failed" };

export function CommandSearch({
  searchInstruments,
  searchStrategies,
}: {
  searchInstruments: InstrumentSearchFn;
  searchStrategies: StrategySearchFn;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open || trimmedQuery.length === 0) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.all([
        searchInstruments({ query: trimmedQuery }),
        searchStrategies({ query: trimmedQuery }),
      ])
        .then(([instruments, strategies]) => {
          if (cancelled) {
            return;
          }
          const merged = mergeSearchOutcomes(instruments, strategies);
          setOutcome(
            merged.kind === "rate_limited"
              ? { query: trimmedQuery, kind: "rate_limited" }
              : {
                  query: trimmedQuery,
                  kind: "ok",
                  instruments: merged.instruments,
                  strategies: merged.strategies,
                  throttled: merged.throttled,
                },
          );
        })
        .catch(() => {
          if (!cancelled) {
            setOutcome({ query: trimmedQuery, kind: "failed" });
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, trimmedQuery, searchInstruments, searchStrategies]);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery("");
    setOutcome(null);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (open) {
          closeAndReset();
        } else {
          setOpen(true);
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeAndReset]);

  // Scoped to the query it answers, the same guard the watchlist combobox
  // uses (#74): a query that changed or was cleared while a search was in
  // flight never shows a superseded query's results, so a fast Enter
  // cannot navigate to a result the current query never matched.
  const currentOutcome = open && outcome?.query === trimmedQuery ? outcome : null;
  const pending = trimmedQuery.length > 0 && currentOutcome === null;
  const instrumentResults =
    trimmedQuery.length > 0 && currentOutcome?.kind === "ok" ? currentOutcome.instruments : [];
  const strategyResults =
    trimmedQuery.length > 0 && currentOutcome?.kind === "ok" ? currentOutcome.strategies : [];
  const searchFailed = trimmedQuery.length > 0 && currentOutcome?.kind === "failed";
  const hasResults = instrumentResults.length > 0 || strategyResults.length > 0;
  const rateLimited =
    trimmedQuery.length > 0 &&
    (currentOutcome?.kind === "rate_limited" ||
      (currentOutcome?.kind === "ok" && currentOutcome.throttled && !hasResults));

  const message = deriveSearchMessage(
    { pending, rateLimited, searchFailed },
    {
      searching: t.search.searching,
      rateLimited: t.search.rateLimited,
      searchError: t.search.searchError,
      empty: t.search.empty,
    },
  );
  const statusText = deriveSearchStatusText(message, {
    trimmedQueryLength: trimmedQuery.length,
    hasResults,
  });

  function selectInstrument(ticker: string) {
    router.push(instrumentHref(ticker));
    closeAndReset();
  }

  function selectStrategy(strategyId: string) {
    router.push(strategyHref(strategyId));
    closeAndReset();
  }

  return (
    <>
      <button
        type="button"
        data-tour="command-search"
        onClick={() => {
          setOpen(true);
        }}
        aria-label={t.search.placeholder}
        className="border-border bg-background text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-[var(--radius)] border px-0 text-[13px] md:w-[360px] md:min-w-0 md:shrink md:justify-start md:px-2.5"
      >
        <Search className="size-3.5" aria-hidden />
        <span className="hidden truncate md:inline">{t.search.placeholder}</span>
        <span className="text-faint ml-auto hidden font-mono text-[11px] md:inline">
          {t.search.shortcut}
        </span>
      </button>
      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setOpen(true);
          } else {
            closeAndReset();
          }
        }}
        title={t.search.placeholder}
        shouldFilter={false}
      >
        <CommandInput placeholder={t.search.placeholder} value={query} onValueChange={setQuery} />
        <CommandStatus>{statusText}</CommandStatus>
        <CommandList>
          {trimmedQuery.length > 0 &&
            (pending ? (
              <CommandLoading label={message}>{message}</CommandLoading>
            ) : (
              <CommandEmpty>{message}</CommandEmpty>
            ))}
          {!pending && !searchFailed && !rateLimited && instrumentResults.length > 0 && (
            <CommandGroup heading={t.search.groups.instruments}>
              {instrumentResults.map((result) => (
                <CommandItem
                  key={result.ticker}
                  value={`instrument:${result.ticker}`}
                  onSelect={() => {
                    selectInstrument(result.ticker);
                  }}
                >
                  <span className="font-mono uppercase">{result.ticker}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!pending && !searchFailed && !rateLimited && strategyResults.length > 0 && (
            <CommandGroup heading={t.search.groups.strategies}>
              {strategyResults.map((result) => (
                <CommandItem
                  key={result.id}
                  value={`strategy:${result.id}`}
                  onSelect={() => {
                    selectStrategy(result.id);
                  }}
                >
                  {result.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
