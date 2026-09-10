"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { InstrumentSearchResult } from "@/modules/market-data";

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

export function AddInstrumentCombobox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstrumentSearchResult[]>([]);
  const [error, setError] = useState(false);

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
            setResults(found);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, trimmedQuery]);

  const displayResults = open && trimmedQuery.length > 0 ? results : [];

  function select(ticker: string) {
    setError(false);
    startTransition(() => {
      addToWatchlistAction({ ticker })
        .then((result) => {
          if (result.status === "ok") {
            setOpen(false);
            setQuery("");
            router.refresh();
          } else {
            setError(true);
          }
        })
        .catch(() => {
          setError(true);
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
              <CommandEmpty>{t.add.empty}</CommandEmpty>
              {displayResults.map((result) => (
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
      {error && <p className="text-destructive text-xs">{t.add.error}</p>}
    </div>
  );
}
