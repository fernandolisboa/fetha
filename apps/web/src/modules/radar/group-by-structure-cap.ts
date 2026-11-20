import type { SuggestionView } from "./suggestion-view";

const SUGGESTIONS_PER_STRUCTURE_CAP = 2;

export interface StructureOverflowGroup {
  structureId: string;
  structureName: string;
  suggestions: SuggestionView[];
}

interface GroupedSuggestions {
  top: SuggestionView[];
  overflow: StructureOverflowGroup[];
}

// #378: a structure's suggestions past `cap` move to their own overflow group instead of
// crowding the top of the panel. `top` and each overflow group both keep the input order.
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

// #378: the watchlist tab's own card limit is taken from the capped, varied order rather than
// the raw one, so a structure that floods the close does not crowd the narrower view out.
export function pickVariedSuggestions(
  suggestions: readonly SuggestionView[],
  limit: number,
): SuggestionView[] {
  return groupSuggestionsByStructureCap(suggestions).top.slice(0, limit);
}
