import type { Metadata } from "next";
import { tickerSchema } from "@fetha/contracts";

import { requireUser } from "@/modules/auth";
import { EmptyState, PageHeader, t as shellStrings } from "@/modules/shell";
import { getCurrentRiskProfile, t } from "@/modules/portfolio";
import { OperationBuilderForm } from "@/modules/portfolio/client";
import { getStructures } from "@/modules/strategies";

export const metadata: Metadata = { title: `Fetha · ${t.builder.title}` };

export default async function NewOperationPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  await requireUser();
  const { ticker: rawTicker } = await searchParams;
  const ticker = tickerSchema.safeParse(rawTicker?.toUpperCase());
  const [structures, riskProfile] = await Promise.all([getStructures(), getCurrentRiskProfile()]);

  if (structures.length === 0) {
    return <EmptyState sentence={shellStrings.emptyStates.portfolio.sentence} />;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <PageHeader overline={t.builder.overline} headline={t.builder.title} />
      <OperationBuilderForm
        structures={structures}
        hasRiskProfile={riskProfile !== null}
        initialUnderlying={ticker.success ? ticker.data : ""}
      />
    </div>
  );
}
