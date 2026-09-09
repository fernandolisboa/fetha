import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { EmptyState, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.signals}` };

export default function SignalsPage() {
  return (
    <EmptyState
      sentence={t.emptyStates.signals.sentence}
      action={<Button>{t.emptyStates.signals.action}</Button>}
    />
  );
}
