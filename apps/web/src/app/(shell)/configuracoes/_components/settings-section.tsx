import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsSection({
  id,
  title,
  subtitle,
  className,
  children,
}: {
  id?: string;
  title: ReactNode;
  subtitle: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4",
        className,
      )}
    >
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground text-xs">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}
