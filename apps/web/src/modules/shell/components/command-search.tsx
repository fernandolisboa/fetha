"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { CommandDialog, CommandEmpty, CommandInput, CommandList } from "@/components/ui/command";

import { t } from "../strings";

export function CommandSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="border-border bg-background text-muted-foreground flex h-8 w-[360px] items-center gap-2 rounded-[var(--radius)] border px-2.5 text-[13px]"
      >
        <Search className="size-3.5" aria-hidden />
        <span className="truncate">{t.search.placeholder}</span>
        <span className="text-faint ml-auto font-mono text-[11px]">{t.search.shortcut}</span>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title={t.search.placeholder}>
        <CommandInput placeholder={t.search.placeholder} />
        <CommandList>
          <CommandEmpty>{t.search.empty}</CommandEmpty>
        </CommandList>
      </CommandDialog>
    </>
  );
}
