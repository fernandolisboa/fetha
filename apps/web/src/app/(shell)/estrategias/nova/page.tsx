import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import { EmptyState, PageHeader, t as shellStrings } from "@/modules/shell";
import { getStructures, StrategyEditorForm, t } from "@/modules/strategies";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.strategies}` };

export default async function NewStrategyPage() {
  await requireUser();
  const structures = await getStructures();

  if (structures.length === 0) {
    return <EmptyState sentence={t.list.emptyCatalog} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
      <PageHeader overline={t.editor.createOverline} headline={t.list.newStrategy} />
      <StrategyEditorForm structures={structures} />
    </div>
  );
}
