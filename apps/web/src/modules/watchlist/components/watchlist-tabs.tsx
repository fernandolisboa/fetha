"use client";

import { useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "../strings";

export type WatchlistTab = "watchlist" | "radar";

export function WatchlistTabs({ tab }: { tab: WatchlistTab }) {
  const router = useRouter();

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        router.push(value === "radar" ? "/?aba=radar" : "/");
      }}
    >
      <TabsList variant="line">
        <TabsTrigger value="watchlist">{t.tabs.watchlist}</TabsTrigger>
        <TabsTrigger value="radar">{t.tabs.radar}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
