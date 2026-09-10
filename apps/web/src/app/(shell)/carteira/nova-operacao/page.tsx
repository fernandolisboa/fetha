import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import { EmptyState, t as shellStrings } from "@/modules/shell";
import { OperationBuilderForm, t } from "@/modules/operations";
import { getCurrentRiskProfile } from "@/modules/risk-profile";
import { getStructures } from "@/modules/strategies";

export const metadata: Metadata = { title: `Fetha · ${t.builder.title}` };

export default async function NewOperationPage() {
  await requireUser();
  const [structures, riskProfile] = await Promise.all([getStructures(), getCurrentRiskProfile()]);

  if (structures.length === 0) {
    return <EmptyState sentence={shellStrings.emptyStates.portfolio.sentence} />;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <div>
        <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t.builder.overline}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight">{t.builder.title}</h1>
      </div>
      <OperationBuilderForm structures={structures} hasRiskProfile={riskProfile !== null} />
    </div>
  );
}
