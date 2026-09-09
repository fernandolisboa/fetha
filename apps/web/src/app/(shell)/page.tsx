import type { Metadata } from "next";

import { EmptyState, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.watchlist}` };

export default function WatchlistPage() {
  return <EmptyState sentence={t.emptyStates.watchlist.sentence} />;
}
