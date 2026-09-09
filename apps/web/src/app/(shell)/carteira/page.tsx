import type { Metadata } from "next";

import { EmptyState, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.portfolio}` };

export default function PortfolioPage() {
  return <EmptyState sentence={t.emptyStates.portfolio.sentence} />;
}
