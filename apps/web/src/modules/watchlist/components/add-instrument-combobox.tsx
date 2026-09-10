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
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { addToWatchlistAction, searchInstrumentsAction } from "../actions";
import { t } from "../strings";

const SEARCH_DEBOUNCE_MS = 200;

interface SearchOutcome {
  query: string;
  results: InstrumentSearchResult[];
  failed: boolean;
}

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
        .then((found) => {
          if (!cancelled) {
            setOutcome({ query: trimmedQuery, results: found, failed: false });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setOutcome({ query: trimmedQuery, results: [], failed: true });
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
  // instrument the current query never matched.
  const currentOutcome = open && outcome?.query === trimmedQuery ? outcome : null;
  const displayResults = trimmedQuery.length > 0 ? (currentOutcome?.results ?? []) : [];
  const searchFailed = trimmedQuery.length > 0 && currentOutcome?.failed === true;

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
            <CommandList>
              <CommandEmpty>{searchFailed ? t.add.searchError : t.add.empty}</CommandEmpty>
              {!searchFailed &&
                displayResults.map((result) => (
                  <CommandItem
                    key={result.ticker}
                    value={result.ticker}
                    onSelect={() => {
                      select(result.ticker);
                    }}
                  >
                    {result.ticker}
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {addError && <p className="text-destructive text-xs">{addError}</p>}
    </div>
  );
}
