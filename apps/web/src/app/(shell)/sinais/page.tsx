import type { Metadata } from "next";

import { EmptyState, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.signals}` };

export default function SignalsPage() {
  return <EmptyState sentence={t.emptyStates.signals.sentence} />;
}
