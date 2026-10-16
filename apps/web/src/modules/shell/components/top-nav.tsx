"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { destinations, formatUnreadCount, isActiveDestination } from "../destinations";
import { t } from "../strings";

// The Studio layout's navigation (ADR-0069): the same six destinations as the
// rail, as tabs in the header. Labels show from 1280px; below that the tabs
// are icons with the label as their accessible name, like the collapsed rail.
export function TopNav({ unreadSignalCount }: { unreadSignalCount: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={t.rail.navigationLabel}
      data-tour="top-nav"
      className="flex min-w-0 items-center gap-0.5 max-md:hidden"
    >
      {destinations().map((destination) => {
        const active = isActiveDestination(pathname, destination.href);
        const unread = destination.showUnreadBadge && unreadSignalCount > 0;
        return (
          <Link
            key={destination.href}
            href={destination.href}
            title={destination.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border px-2.5 text-[13px] transition-colors duration-[120ms]",
              active
                ? "border-primary/60 bg-accent text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground border-transparent",
            )}
          >
            <destination.icon className="size-4 shrink-0" aria-hidden />
            <span className="max-xl:sr-only">{destination.label}</span>
            {unread ? (
              <span className="bg-primary text-primary-foreground min-w-4 rounded-full px-1 text-center font-mono text-[10px] leading-4 tabular-nums">
                {formatUnreadCount(unreadSignalCount)}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
