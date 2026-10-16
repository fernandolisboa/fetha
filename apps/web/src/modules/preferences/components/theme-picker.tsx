import { themeMode, themes, type Theme } from "../theme";
import { cn } from "@/lib/utils";
import { setThemeAction } from "../actions";
import { t as preferencesStrings } from "../strings";

export function ThemePicker({ current }: { current: Theme }) {
  return (
    <div
      className="grid gap-2 @min-[40rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[80rem]:grid-cols-4"
      role="radiogroup"
      aria-label={preferencesStrings.themePicker.title}
    >
      {themes.map((theme) => {
        const option = preferencesStrings.themePicker.options[theme];
        const active = theme === current;
        return (
          <form
            action={async (formData: FormData) => {
              "use server";
              await setThemeAction(formData);
            }}
            key={theme}
          >
            <input type="hidden" name="theme" value={theme} />
            <button
              type="submit"
              role="radio"
              aria-checked={active}
              className={cn(
                "border-border hover:bg-secondary flex h-full w-full flex-col gap-2 rounded-[var(--radius)] border p-2 text-left transition-colors duration-[120ms]",
                active && "border-primary bg-accent hover:bg-accent",
              )}
            >
              <ThemePreview theme={theme} />
              <span className="flex flex-col gap-0.5 px-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {preferencesStrings.themePicker.modes[themeMode(theme)]}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">{option.description}</span>
              </span>
            </button>
          </form>
        );
      })}
    </div>
  );
}

// A thumbnail of the shell drawn in the theme's own tokens: `data-theme` on
// the wrapper resolves every var() below against that theme (ADR-0015).
function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <span
      data-theme={theme}
      aria-hidden
      className="flex h-16 w-full overflow-hidden border"
      style={{
        background: "var(--bg)",
        borderColor: "var(--line)",
        borderRadius: "var(--radius)",
      }}
    >
      <span
        className="flex w-1/5 flex-col gap-1 border-r p-1.5"
        style={{ background: "var(--surface)", borderColor: "var(--line)" }}
      >
        <span className="h-1 w-full rounded-full" style={{ background: "var(--accent)" }} />
        <span className="h-1 w-3/4 rounded-full" style={{ background: "var(--muted)" }} />
        <span className="h-1 w-3/4 rounded-full" style={{ background: "var(--muted)" }} />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: "var(--ink)" }} />
        <span className="h-1 w-3/4 rounded-full" style={{ background: "var(--muted)" }} />
        <span className="mt-auto flex items-center gap-1.5">
          <span
            className="h-2.5 w-8"
            style={{ background: "var(--accent)", borderRadius: "var(--radius)" }}
          />
          <span className="h-1.5 w-4 rounded-full" style={{ background: "var(--up)" }} />
          <span className="h-1.5 w-4 rounded-full" style={{ background: "var(--down)" }} />
        </span>
      </span>
    </span>
  );
}
