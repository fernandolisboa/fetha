import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
    <Alert
      variant="destructive"
      role={live ? "alert" : undefined}
      className={cn(
        "w-auto gap-0 rounded-none border-0 bg-transparent p-0 text-xs has-[>svg]:gap-x-1.5 *:[svg]:row-span-1",
        className,
      )}
    >
      <CircleAlert aria-hidden="true" className="size-3.5" />
      <AlertDescription className="text-destructive text-xs text-pretty">
        {children}
      </AlertDescription>
    </Alert>
  );
}
