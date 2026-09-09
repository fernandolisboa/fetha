import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { EmptyState, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.watchlist}` };

export default function WatchlistPage() {
  return (
    <EmptyState
      sentence={t.emptyStates.watchlist.sentence}
      action={<Button>{t.emptyStates.watchlist.action}</Button>}
    />
  );
}
