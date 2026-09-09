import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { EmptyState, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.strategies}` };

export default function StrategiesPage() {
  return (
    <EmptyState
      sentence={t.emptyStates.strategies.sentence}
      action={<Button>{t.emptyStates.strategies.action}</Button>}
    />
  );
}
