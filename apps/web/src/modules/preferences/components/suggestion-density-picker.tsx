import { cn } from "@/lib/utils";

import { setSuggestionDensityAction } from "../actions";
import { suggestionDensities, type SuggestionDensity } from "../suggestion-density";
import { t as preferencesStrings } from "../strings";

export function SuggestionDensityPicker({ current }: { current: SuggestionDensity }) {
  return (
    <div
      className="grid gap-2 @min-[40rem]:grid-cols-2"
      role="radiogroup"
      aria-label={preferencesStrings.suggestionDensityPicker.title}
    >
      {suggestionDensities.map((density) => {
        const option = preferencesStrings.suggestionDensityPicker.options[density];
        const active = density === current;
        return (
          <form
            action={async (formData: FormData) => {
              "use server";
              await setSuggestionDensityAction(formData);
            }}
            key={density}
          >
            <input type="hidden" name="suggestionDensity" value={density} />
            <button
              type="submit"
              role="radio"
              aria-checked={active}
              className={cn(
                "border-border hover:bg-secondary flex h-full w-full flex-col gap-0.5 rounded-[var(--radius)] border p-2 text-left transition-colors duration-[120ms]",
                active && "border-primary bg-accent hover:bg-accent",
              )}
            >
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-muted-foreground text-xs">{option.description}</span>
            </button>
          </form>
        );
      })}
    </div>
  );
}
