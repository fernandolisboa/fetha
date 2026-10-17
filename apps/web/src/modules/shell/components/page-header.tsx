import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Studio (ADR-0069) sets the overline and the headline on one compact line,
// from 768px up like the rest of the layout.
const DEFAULT_HEADLINE_CLASS_NAME =
  "text-[22px] font-semibold tracking-tight md:studio:text-[18px] md:studio:leading-tight";
const DEFAULT_ACTIONS_WRAPPER_CLASS_NAME = "flex flex-wrap items-center justify-between gap-3";

export function PageHeader({
  overline,
  headline,
  headlineClassName,
  actions,
  actionsWrapperClassName,
}: {
  overline: ReactNode;
  headline: ReactNode;
  headlineClassName?: string;
  actions?: ReactNode;
  actionsWrapperClassName?: string;
}) {
  const heading = (
    <div className="md:studio:flex md:studio:flex-wrap md:studio:items-baseline md:studio:gap-x-3">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{overline}</p>
      <h1 className={cn(DEFAULT_HEADLINE_CLASS_NAME, headlineClassName)}>{headline}</h1>
    </div>
  );

  if (!actions) {
    return heading;
  }

  return (
    <div className={cn(DEFAULT_ACTIONS_WRAPPER_CLASS_NAME, actionsWrapperClassName)}>
      {heading}
      {actions}
    </div>
  );
}
