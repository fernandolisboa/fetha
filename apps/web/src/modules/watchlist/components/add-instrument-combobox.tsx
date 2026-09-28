"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { InstrumentSearchResult } from "@/modules/market-data/client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandStatus,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ErrorNotice } from "@/components/error-notice";

import { addToWatchlistAction, searchInstrumentsAction } from "../actions";
import { t } from "../strings";
import { deriveSearchMessage, deriveSearchStatusText } from "./search-status";

const SEARCH_DEBOUNCE_MS = 200;

type SearchOutcome =
  | { query: string; kind: "ok"; results: InstrumentSearchResult[] }
  | { query: string; kind: "rate_limited" }
  | { query: string; kind: "failed" };

export function AddInstrumentCombobox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open || trimmedQuery.length === 0) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchInstrumentsAction({ query: trimmedQuery })
        .then((result) => {
          if (cancelled) {
            return;
          }
          setOutcome(
            result.status === "error"
              ? { query: trimmedQuery, kind: "rate_limited" }
              : { query: trimmedQuery, kind: "ok", results: result.results },
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
  }, [open, trimmedQuery]);

  // The outcome is scoped to the query it answers: a query that changed
  // (or was cleared) while a search was in flight never shows a
  // superseded query's results, so a fast Enter cannot select an
  // instrument the current query never matched. Until that outcome
  // arrives, the query is pending: no "no results found" copy flashes
  // ahead of an answer that just hasn't come back yet.
  const currentOutcome = open && outcome?.query === trimmedQuery ? outcome : null;
  const pending = trimmedQuery.length > 0 && currentOutcome === null;
  const displayResults =
    trimmedQuery.length > 0 && currentOutcome?.kind === "ok" ? currentOutcome.results : [];
  const searchFailed = trimmedQuery.length > 0 && currentOutcome?.kind === "failed";
  const rateLimited = trimmedQuery.length > 0 && currentOutcome?.kind === "rate_limited";
  const hasResults = displayResults.length > 0;

  const message = deriveSearchMessage(
    { pending, rateLimited, searchFailed },
    {
      searching: t.add.searching,
      rateLimited: t.add.rateLimited,
      searchError: t.add.searchError,
      empty: t.add.empty,
    },
  );
  const statusText = deriveSearchStatusText(message, {
    trimmedQueryLength: trimmedQuery.length,
    hasResults,
  });

  function select(ticker: string) {
    setAddError(null);
    startTransition(() => {
      addToWatchlistAction({ ticker })
        .then((result) => {
          if (result.status === "ok") {
            setOpen(false);
            setQuery("");
            setOutcome(null);
            router.refresh();
          } else {
            setAddError(result.error === "cap" ? t.add.cap : t.add.error);
          }
        })
        .catch(() => {
          setAddError(t.add.error);
        });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Above the trigger: the results panel stays open after a failed add
          and opens downward, so a notice below the button would sit under it. */}
      {addError && <ErrorNotice>{addError}</ErrorNotice>}
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setQuery("");
            setOutcome(null);
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button type="button" variant="default">
              <Plus aria-hidden />
              {t.add.trigger}
            </Button>
          }
        />
        <PopoverContent className="w-64 p-0" align="end">
          <Command shouldFilter={false}>
            <CommandInput placeholder={t.add.placeholder} value={query} onValueChange={setQuery} />
            <CommandStatus>{statusText}</CommandStatus>
            <CommandList>
              {pending ? (
                <CommandLoading label={message}>{message}</CommandLoading>
              ) : (
                <CommandEmpty>{message}</CommandEmpty>
              )}
              {!pending &&
                !searchFailed &&
                !rateLimited &&
                displayResults.map((result) => (
                  <CommandItem
                    key={result.ticker}
                    value={result.ticker}
                    onSelect={() => {
                      select(result.ticker);
                    }}
                  >
                    <span className="font-mono uppercase">{result.ticker}</span>
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
