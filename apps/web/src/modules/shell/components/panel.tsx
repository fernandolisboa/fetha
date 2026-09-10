import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4",
        className,
      )}
    >
      {title && (
        <div>
          <h2 className="text-[13px] font-medium">{title}</h2>
          {subtitle && <p className="text-muted-foreground text-xs">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
