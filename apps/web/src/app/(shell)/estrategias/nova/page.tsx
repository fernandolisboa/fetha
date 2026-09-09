import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import { t as shellStrings } from "@/modules/shell";
import { getStructures, StrategyEditorForm, t } from "@/modules/strategies";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.strategies}` };

export default async function NewStrategyPage() {
  await requireUser();
  const structures = await getStructures();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
      <div>
        <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t.editor.createOverline}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight">{t.list.newStrategy}</h1>
      </div>
      <StrategyEditorForm structures={structures} />
    </div>
  );
}
