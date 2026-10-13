import { recipeById } from "@/modules/strategies";
import { Panel } from "@/modules/shell";

import { recipeCards } from "../cards";
import { conditionLines, exitText } from "../rule-text";
import { t } from "../strings";

// The rule screen "Ver receita" leads to (docs/adr/0067): what the recipe is in plain words and
// the exact entry and exit rules the radar and a backtest apply.
export function RecipeRule({ recipeId }: { recipeId: string }) {
  const recipe = recipeById(recipeId);
  const card = recipeCards().find((entry) => entry.id === recipeId);
  if (!recipe || !card) return null;

  return (
    <Panel title={t.rule.title} subtitle={recipe.definition.name}>
      <div className="flex flex-col gap-1 text-[13px]" data-testid="recipe-rule">
        <p className="text-pretty">{card.summary}</p>
        <p className="text-muted-foreground text-xs">{card.maxLoss}</p>
        <p className="text-muted-foreground text-xs">{t.picker.ivRegimes[card.ivRegime]}</p>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">{t.rule.entry}</p>
        <ul className="flex flex-col gap-0.5 font-mono text-xs tabular-nums">
          {conditionLines(recipe.definition.entry).map((line, index) => (
            <li key={`${line.text}-${String(index)}`} style={{ paddingLeft: line.depth * 12 }}>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">{t.rule.exit}</p>
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs">
          {recipe.definition.exit.map((rule, index) => (
            <li key={`${rule.kind}-${String(index)}`}>{exitText(rule)}</li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
