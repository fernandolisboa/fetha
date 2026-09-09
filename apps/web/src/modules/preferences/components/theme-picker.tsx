import { themes, type Theme } from "../theme";
import { cn } from "@/lib/utils";
import { setThemeAction } from "../actions";
import { t as preferencesStrings } from "../strings";

export function ThemePicker({ current }: { current: Theme }) {
  return (
    <div
      className="flex flex-col gap-2"
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
                "border-border flex w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left",
                active && "border-primary bg-accent",
              )}
            >
              <span
                data-theme={theme}
                className="border-border flex size-6 shrink-0 overflow-hidden rounded-full border"
                style={{ background: "var(--bg)" }}
              >
                <span
                  className="block size-full"
                  style={{
                    background: "linear-gradient(135deg, var(--ink) 50%, var(--accent) 50%)",
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
