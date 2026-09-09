import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { EmptyState, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.journal}` };

export default function JournalPage() {
  return (
    <EmptyState
      sentence={t.emptyStates.journal.sentence}
      action={<Button>{t.emptyStates.journal.action}</Button>}
    />
  );
}
