import type { ReactNode } from "react";

export function EmptyState({ sentence, action }: { sentence: string; action: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="text-muted-foreground text-sm">{sentence}</p>
      {action}
    </div>
  );
}
