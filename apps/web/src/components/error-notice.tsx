import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

// live=false drops role="alert": a notice already present at first render
// (fetched, not just triggered) shouldn't announce itself on page load.
export function ErrorNotice({
  children,
  className,
  live = true,
}: {
  children: ReactNode;
  className?: string;
  live?: boolean;
}) {
  return (
    <p
      role={live ? "alert" : undefined}
      className={cn("text-destructive flex items-start gap-1.5 text-xs", className)}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
