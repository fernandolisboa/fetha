import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { EmptyState, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.portfolio}` };

export default function PortfolioPage() {
  return (
    <EmptyState
      sentence={t.emptyStates.portfolio.sentence}
      action={<Button>{t.emptyStates.portfolio.action}</Button>}
    />
  );
}
