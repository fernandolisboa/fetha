import { type ExpectedMove } from "@fetha/contracts";
import { z } from "zod";

// The asset page's one question (ticket #379): "O que você espera de TICKER nas próximas
// semanas?", answered sobe / cai / fica de lado / não sei.
export const planViews = ["up", "down", "sideways", "unsure"] as const;
export const planViewSchema = z.enum(planViews);
export type PlanView = z.infer<typeof planViewSchema>;

// The recipe book's own expected moves (docs/adr/0064) a stated view admits: "sobe"/"cai"/"fica
// de lado" name one each; "não sei" states no direction, so it admits every recipe that does not
// claim a one-sided move — "sideways" and "big_move" — rather than matching by IV regime alone
// (ticket #379 round 1 review item 2).
export function movesForView(view: PlanView): readonly ExpectedMove[] {
  switch (view) {
    case "up":
      return ["up"];
    case "down":
      return ["down"];
    case "sideways":
      return ["sideways"];
    case "unsure":
      return ["sideways", "big_move"];
  }
}
