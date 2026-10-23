import { cn } from "@/lib/utils";

import { setLayoutAction } from "../actions";
import { layouts, type Layout } from "../layout";
import { t as preferencesStrings } from "../strings";

export function LayoutPicker({ current }: { current: Layout }) {
  return (
    <div
      className="grid gap-2 @min-[40rem]:grid-cols-3"
      role="radiogroup"
      aria-label={preferencesStrings.layoutPicker.title}
    >
      {layouts.map((layout) => {
        const option = preferencesStrings.layoutPicker.options[layout];
        const active = layout === current;
        return (
          <form
            action={async (formData: FormData) => {
              "use server";
              await setLayoutAction(formData);
            }}
            key={layout}
          >
            <input type="hidden" name="layout" value={layout} />
            <button
              type="submit"
              role="radio"
              aria-checked={active}
              className={cn(
                "border-border hover:bg-secondary flex h-full w-full flex-col gap-2 rounded-[var(--radius)] border p-2 text-left transition-colors duration-[120ms]",
                active && "border-primary bg-accent hover:bg-accent",
              )}
            >
              <LayoutPreview layout={layout} />
              <span className="flex flex-col gap-0.5 px-1">
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

function Bar({ className }: { className: string }) {
  return <span className={cn("bg-muted-foreground/60 block h-1 rounded-full", className)} />;
}

// A wireframe in the current theme: where the navigation and the market bar
// go, not a screenshot.
function LayoutPreview({ layout }: { layout: Layout }) {
  return (
    <span
      aria-hidden
      className="border-border bg-background flex h-20 w-full flex-col overflow-hidden rounded-[var(--radius)] border"
    >
      <LayoutWireframe layout={layout} />
    </span>
  );
}

function LayoutWireframe({ layout }: { layout: Layout }) {
  switch (layout) {
    case "workspace":
      return (
        <>
          <span className="border-border bg-card flex h-3.5 shrink-0 items-center gap-1.5 border-b px-1.5">
            <Bar className="w-3" />
            <Bar className="w-10" />
            <span className="bg-primary/70 ml-auto block h-1 w-6 rounded-full" />
          </span>
          <span className="flex min-h-0 flex-1">
            <span className="border-border bg-card flex w-1/5 flex-col gap-1 border-r p-1.5">
              <span className="bg-primary block h-1 w-full rounded-full" />
              <Bar className="w-3/4" />
              <Bar className="w-3/4" />
              <Bar className="w-3/4" />
            </span>
            <span className="flex flex-1 flex-col gap-1 p-1.5">
              <Bar className="w-1/3" />
              <span className="flex flex-1 gap-1">
                <span className="border-border flex-1 rounded-[2px] border" />
                <span className="border-border w-1/4 rounded-[2px] border" />
              </span>
            </span>
          </span>
        </>
      );
    case "studio":
      return (
        <>
          <span className="border-border bg-card flex h-3.5 shrink-0 items-center gap-1.5 border-b px-1.5">
            <Bar className="w-3" />
            <span className="bg-primary block h-1 w-4 rounded-full" />
            <Bar className="w-4" />
            <Bar className="w-4" />
            <Bar className="w-4" />
          </span>
          <span className="flex flex-1 flex-col gap-1 p-1.5">
            <Bar className="w-1/4" />
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="border-border h-1.5 border-b" />
              <span className="border-border h-1.5 border-b" />
              <span className="border-border h-1.5 border-b" />
            </span>
          </span>
          <span className="border-border bg-card flex h-2.5 shrink-0 items-center gap-1.5 border-t px-1.5">
            <Bar className="w-8" />
            <span className="bg-primary/70 ml-auto block h-1 w-5 rounded-full" />
          </span>
        </>
      );
    case "dock":
      return (
        <>
          <span className="border-border bg-card flex h-3.5 shrink-0 items-center gap-1.5 border-b px-1.5">
            <Bar className="w-3" />
            <Bar className="w-10" />
            <span className="bg-primary/70 ml-auto block h-1 w-6 rounded-full" />
          </span>
          <span className="flex min-h-0 flex-1 items-start gap-1.5 p-1.5">
            <span className="border-border bg-card flex w-3 flex-col items-center gap-1 rounded-[calc(var(--radius)*2)] border py-1 shadow-[var(--shell-float-shadow)]">
              <span className="bg-primary block size-1 rounded-full" />
              <Bar className="w-1" />
              <Bar className="w-1" />
              <Bar className="w-1" />
            </span>
            <span className="flex flex-1 flex-col gap-1 self-stretch">
              <Bar className="w-1/3" />
              <span className="flex flex-1 gap-1">
                <span className="border-border flex-1 rounded-[2px] border" />
                <span className="border-border w-1/4 rounded-[2px] border" />
              </span>
            </span>
          </span>
        </>
      );
    default: {
      const unknown: never = layout;
      return unknown;
    }
  }
}
