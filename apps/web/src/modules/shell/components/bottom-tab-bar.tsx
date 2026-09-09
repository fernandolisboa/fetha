"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { destinations } from "../destinations";

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="border-border bg-card fixed inset-x-0 bottom-0 z-10 hidden h-14 items-center justify-around border-t max-md:flex">
      {destinations().map((destination) => {
        const active = pathname === destination.href;
        return (
          <Link
            key={destination.href}
            href={destination.href}
            aria-label={destination.label}
            className={cn(
              "relative flex flex-col items-center gap-0.5 px-2 text-[11px]",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <destination.icon className="size-5" aria-hidden />
            {destination.showUnreadBadge ? (
              <Badge
                variant="secondary"
                className="bg-primary text-primary-foreground absolute -top-1 right-0 h-4 min-w-4 px-1 font-mono text-[10px]"
              >
                0
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
