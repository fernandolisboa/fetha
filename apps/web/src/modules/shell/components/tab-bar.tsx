"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { destinations, formatUnreadCount, isActiveDestination } from "../destinations";
import { t } from "../strings";

export function TabBar({ unreadSignalCount }: { unreadSignalCount: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={t.rail.navigationLabel}
      data-tour="tab-bar"
      className="border-border bg-card fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t md:hidden"
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
              "relative flex h-14 items-center justify-center transition-colors duration-[120ms]",
              active
                ? "text-primary before:bg-primary before:absolute before:inset-x-3 before:top-0 before:h-0.5"
                : "text-muted-foreground active:bg-secondary",
            )}
          >
            <destination.icon className="size-5" aria-hidden />
            <span className="sr-only">{destination.label}</span>
            {unread ? (
              <span className="bg-primary text-primary-foreground absolute top-2 left-1/2 ml-1 min-w-4 rounded-full px-1 text-center font-mono text-[10px] leading-4 tabular-nums">
                {formatUnreadCount(unreadSignalCount)}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
