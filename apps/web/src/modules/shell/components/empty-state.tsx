import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export interface EmptyStateAction {
  label: string;
  href: string;
}

export function EmptyState({ sentence, action }: { sentence: string; action?: EmptyStateAction }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="text-muted-foreground text-sm">{sentence}</p>
      {action ? (
        <Link href={action.href} className={buttonVariants()}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
