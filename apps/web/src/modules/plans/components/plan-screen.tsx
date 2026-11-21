import type { BuildPlanActionInput, BuildPlanOutcome } from "../actions";
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
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[15px] text-pretty">{outcome.plan.summary}</p>
      <PlanAdjuster outcome={outcome} riskLimitCentavos={riskLimitCentavos} input={input} />
    </div>
  );
}
