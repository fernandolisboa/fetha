import Link from "next/link";

import { lessonHrefForStructure } from "@/modules/learning";
import { catalog } from "@/modules/strategies";

import type { BuildPlanActionInput, BuildPlanOutcome } from "../actions";
import { t } from "../strings";
import { PlanAdjuster } from "./plan-adjuster";

// The plan screen (ticket #379): summary paragraph, then everything drag-to-adjust (ticket
// #380) made editable — numbers, orders, the payoff chart, rules and the save button — in
// `PlanAdjuster`, which starts from exactly this plan and lets the user move a handle before
// saving.
export function PlanScreen({
  outcome,
  riskLimitCentavos,
  input,
}: {
  outcome: Extract<BuildPlanOutcome, { status: "ok" }>;
  riskLimitCentavos: number;
  input: BuildPlanActionInput;
}) {
  const lessonHref = lessonHrefForStructure(outcome.plan.structureId);
  const structureName =
    catalog.find((entry) => entry.structure.id === outcome.plan.structureId)?.structure.name ??
    outcome.plan.structureId;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[15px] text-pretty">{outcome.plan.summary}</p>
      {lessonHref && (
        <Link
          href={lessonHref}
          className="text-muted-foreground w-fit text-[11px] underline-offset-4 hover:underline"
        >
          {t.learnStructure(structureName)}
        </Link>
      )}
      <PlanAdjuster outcome={outcome} riskLimitCentavos={riskLimitCentavos} input={input} />
    </div>
  );
}
