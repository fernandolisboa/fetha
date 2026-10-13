import Link from "next/link";
import { decimalStringSchema, type Ticker } from "@fetha/contracts";

import { formatPercent } from "@/lib/format/percent";
import { getMyBacktestRunsForStrategy, reportHref } from "@/modules/backtests";
import { getMyStrategies, recipeById } from "@/modules/strategies";

import { DEFAULT_RECIPE_RISK_FRACTION } from "../risk";
import { t } from "../strings";
import { RecipeTestButton } from "./recipe-test-button";

// docs/adr/0067: a recipe's backtest on one ticker runs on demand and is kept as the user's own
// run; the strategy the recipe start flow names "{structure} em {ticker}" is how a later visit
// finds it instead of starting another.
async function myRecipeRun(recipeId: string, ticker: Ticker) {
  const recipe = recipeById(recipeId);
  if (!recipe) return null;
  const name = t.strategyName
    .replace("{structure}", recipe.definition.name)
    .replace("{ticker}", ticker);
  const strategy = (await getMyStrategies()).find((candidate) => candidate.name === name);
  if (!strategy) return null;
  const [latest] = await getMyBacktestRunsForStrategy(strategy.id);
  return latest ? { strategyId: strategy.id, runId: latest.id } : null;
}

export async function RecipeTest({ recipeId, ticker }: { recipeId: string; ticker: Ticker }) {
  const existing = await myRecipeRun(recipeId, ticker);
  return (
    <section aria-label={t.test.title} className="flex flex-col gap-2">
      <h2 className="text-[13px] font-medium">{t.test.title}</h2>
      {existing ? (
        <p className="text-[13px]" data-testid="recipe-test-existing">
          {t.test.existing(ticker)}{" "}
          <Link
            href={reportHref(existing.strategyId, existing.runId)}
            className="text-primary underline-offset-4 hover:underline"
          >
            {t.test.open}
          </Link>
        </p>
      ) : (
        <>
          <RecipeTestButton recipeId={recipeId} ticker={ticker} />
          <p className="text-muted-foreground text-xs text-pretty">
            {t.test.footnote(
              ticker,
              formatPercent(decimalStringSchema.parse(DEFAULT_RECIPE_RISK_FRACTION)),
            )}
          </p>
        </>
      )}
    </section>
  );
}
