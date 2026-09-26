import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_HEADLINE_CLASS_NAME = "text-[22px] font-semibold tracking-tight";
const DEFAULT_ACTIONS_WRAPPER_CLASS_NAME = "flex items-center justify-between";

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
    <div>
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
