import type { Ticker } from "@fetha/contracts";

import { getCurrentRiskProfile } from "@/modules/portfolio";
import { Panel } from "@/modules/shell";

import { recipeCards, riskOptions } from "../cards";
import { t } from "../strings";
import { RecipePicker } from "./recipe-picker";

export async function RecipePanel({ ticker }: { ticker: Ticker }) {
  const riskProfile = await getCurrentRiskProfile();
  return (
    <Panel title={t.panel.title} subtitle={t.panel.subtitle.replace("{ticker}", ticker)}>
      <RecipePicker
        ticker={ticker}
        cards={recipeCards()}
        riskOptions={riskProfile ? riskOptions(riskProfile.declaredCapital) : null}
      />
    </Panel>
  );
}
