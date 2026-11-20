import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/modules/auth";
import { DEFAULT_RISK_PROFILE, getCurrentRiskProfile } from "@/modules/portfolio";
import {
  buildPlanAction,
  PlanScreen,
  planViewSchema,
  riskLimitCentavos,
  t,
  type BuildPlanActionInput,
} from "@/modules/plans";
import { PageHeader, t as shellStrings } from "@/modules/shell";
import { ErrorNotice } from "@/components/error-notice";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.watchlist}` };

function inputFrom(
  searchParams: Record<string, string | string[] | undefined>,
): BuildPlanActionInput | null {
  const suggestionId = searchParams.sugestao;
  if (typeof suggestionId === "string" && suggestionId.length > 0) {
    return { kind: "suggestion", suggestionId };
  }
  const ticker = searchParams.ticker;
  const view = planViewSchema.safeParse(searchParams.view);
  if (typeof ticker === "string" && ticker.length > 0 && view.success) {
    return { kind: "view", underlying: ticker, view: view.data };
  }
  return null;
}

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const input = inputFrom(await searchParams);
  if (!input) notFound();

  const [outcome, riskProfile] = await Promise.all([
    buildPlanAction(input),
    getCurrentRiskProfile(),
  ]);
  const riskLimit = riskLimitCentavos(riskProfile ?? DEFAULT_RISK_PROFILE);

  return (
    <div className="flex flex-col gap-6 px-5 py-8">
      <PageHeader
        overline={
          input.kind === "view"
            ? t.screen.overline.replace("{ticker}", input.underlying)
            : t.screen.title
        }
        headline={t.screen.title}
      />
      {outcome.status === "ok" ? (
        <PlanScreen
          outcome={outcome}
          riskLimitCentavos={riskLimit}
          cashTodayCentavos={outcome.plan.netPremiumCentavos}
          input={input}
        />
      ) : (
        <ErrorNotice>{t.screen.errors[outcome.error]}</ErrorNotice>
      )}
    </div>
  );
}
