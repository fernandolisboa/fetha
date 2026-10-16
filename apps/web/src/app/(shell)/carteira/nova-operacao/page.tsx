import type { Metadata } from "next";
import { tickerSchema } from "@fetha/contracts";

import { requireUser } from "@/modules/auth";
import { EmptyState, PageHeader, t as shellStrings } from "@/modules/shell";
import { getCurrentRiskProfile, t } from "@/modules/portfolio";
import { OperationBuilderForm } from "@/modules/portfolio/client";
import { getSuggestion, SuggestionNotFoundError } from "@/modules/radar";
import { getStructures } from "@/modules/strategies";

export const metadata: Metadata = { title: `Fetha · ${t.builder.title}` };

export default async function NewOperationPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string | string[]; sugestao?: string | string[] }>;
}) {
  await requireUser();
  const { ticker: rawTicker, sugestao } = await searchParams;
  const [structures, riskProfile, suggestion] = await Promise.all([
    getStructures(),
    getCurrentRiskProfile(),
    typeof sugestao === "string"
      ? getSuggestion(sugestao).catch((error: unknown) => {
          if (error instanceof SuggestionNotFoundError) return null;
          throw error;
        })
      : null,
  ]);
  const ticker = tickerSchema.safeParse(
    suggestion?.underlying ?? (typeof rawTicker === "string" ? rawTicker.toUpperCase() : undefined),
  );

  if (structures.length === 0) {
    return <EmptyState sentence={shellStrings.emptyStates.portfolio.sentence} />;
  }

  return (
    <div className="flex flex-col gap-6 px-5 py-8">
      <PageHeader overline={t.builder.overline} headline={t.builder.title} />
      <OperationBuilderForm
        structures={structures}
        hasRiskProfile={riskProfile !== null}
        initialUnderlying={ticker.success ? ticker.data : ""}
        initialStructureId={suggestion?.structure.id}
        initialLegs={suggestion?.entryLegs.map(({ role, side, ticker: leg, quantity }) => ({
          role,
          side,
          ticker: leg,
          quantity,
        }))}
      />
    </div>
  );
}
