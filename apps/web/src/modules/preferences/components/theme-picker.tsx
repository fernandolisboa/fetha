import type { Theme } from "@fetha/contracts";
import { themes } from "@fetha/contracts";
import { cn } from "@/lib/utils";
import { setThemeAction } from "../actions";
import { t as preferencesStrings } from "../strings";

// Representative hex values per theme (DESIGN.md), used only to paint the
// picker's swatches; the active theme's own tokens are what actually style
// the page once chosen.
const swatches: Record<Theme, { bg: string; surface: string; accent: string }> = {
  instrumento: { bg: "#0f1115", surface: "#151922", accent: "#3fb8c8" },
  terminal: { bg: "#0a0b0d", surface: "#111317", accent: "#e0a83a" },
  amplo: { bg: "#13151b", surface: "#191c24", accent: "#c9a25a" },
};

export function ThemePicker({ current }: { current: Theme }) {
  return (
    <div
      className="flex flex-col gap-2"
      role="radiogroup"
      aria-label={preferencesStrings.themePicker.title}
    >
      {themes.map((theme) => {
        const swatch = swatches[theme];
        const option = preferencesStrings.themePicker.options[theme];
        const active = theme === current;
        return (
          <form action={setThemeAction} key={theme}>
            <input type="hidden" name="theme" value={theme} />
            <button
              type="submit"
              role="radio"
              aria-checked={active}
              className={cn(
                "border-border flex w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left",
                active && "border-primary bg-accent",
              )}
            >
              <span
                className="border-border flex size-6 shrink-0 overflow-hidden rounded-full border"
                style={{ background: swatch.bg }}
              >
                <span
                  className="block size-full"
                  style={{
                    background: `linear-gradient(135deg, ${swatch.surface} 50%, ${swatch.accent} 50%)`,
                  }}
                />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-muted-foreground text-xs">{option.description}</span>
              </span>
            </button>
          </form>
        );
      })}
    </div>
  );
}
