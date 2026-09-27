import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

export function ErrorNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("text-destructive flex items-start gap-1.5 text-xs", className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
