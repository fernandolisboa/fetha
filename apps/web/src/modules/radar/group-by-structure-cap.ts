import type { SuggestionView } from "./suggestion-view";

export const SUGGESTIONS_PER_STRUCTURE_CAP = 2;

export interface StructureOverflowGroup {
  structureId: string;
  structureName: string;
  suggestions: SuggestionView[];
}

export interface GroupedSuggestions {
  top: SuggestionView[];
  overflow: StructureOverflowGroup[];
}

// #378: once a structure (almost always the call butterfly) has `cap` suggestions already
// shown, every later one of that structure moves behind its own "mais desta estrutura"
// disclosure instead of crowding the top of the panel. Order is untouched otherwise: `top` keeps
// the input order minus the moved ones, and each overflow group keeps the input order of the
// suggestions inside it, grouped by the structure's first appearance.
export function groupSuggestionsByStructureCap(
  suggestions: readonly SuggestionView[],
  cap: number = SUGGESTIONS_PER_STRUCTURE_CAP,
): GroupedSuggestions {
  const shownByStructure = new Map<string, number>();
  const overflowByStructure = new Map<string, StructureOverflowGroup>();
  const top: SuggestionView[] = [];

  for (const suggestion of suggestions) {
    const structureId = suggestion.structure.id;
    const shown = shownByStructure.get(structureId) ?? 0;
    if (shown < cap) {
      shownByStructure.set(structureId, shown + 1);
      top.push(suggestion);
      continue;
    }
    const group = overflowByStructure.get(structureId);
    if (group) {
      group.suggestions.push(suggestion);
    } else {
      overflowByStructure.set(structureId, {
        structureId,
        structureName: suggestion.structure.name,
        suggestions: [suggestion],
      });
    }
  }

  return { top, overflow: [...overflowByStructure.values()] };
}
