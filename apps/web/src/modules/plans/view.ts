import { expectedMoveSchema, type ExpectedMove } from "@fetha/contracts";
import { z } from "zod";

// The asset page's one question (ticket #379): "O que você espera de TICKER nas próximas
// semanas?", answered sobe / cai / fica de lado / não sei.
export const planViews = ["up", "down", "sideways", "unsure"] as const;
export const planViewSchema = z.enum(planViews);
export type PlanView = z.infer<typeof planViewSchema>;

// Every view but "não sei" names one of the recipe book's own expected moves
// (docs/adr/0064); "não sei" states no direction, so the recipe is picked by IV regime alone.
export function expectedMoveForView(view: PlanView): ExpectedMove | null {
  switch (view) {
    case "up":
      return expectedMoveSchema.parse("up");
    case "down":
      return expectedMoveSchema.parse("down");
    case "sideways":
      return expectedMoveSchema.parse("sideways");
    case "unsure":
      return null;
  }
}
