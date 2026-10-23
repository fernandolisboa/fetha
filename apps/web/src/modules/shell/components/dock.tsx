"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Centavos } from "@fetha/contracts";

import { cn } from "@/lib/utils";

import { DeclaredCapitalValue } from "./declared-capital";
import { destinations, formatUnreadCount, isActiveDestination } from "../destinations";
import { t } from "../strings";

// The Dock layout's navigation (ADR-0071): the six destinations in a floating
// panel over the page's left edge instead of a rail column. Icons only at
// rest; from 1024px it widens over the content to show labels and the
// declared capital while the pointer is on it or a keyboard focus is inside,
// so it never takes width from the page.
export function Dock({
  unreadSignalCount,
  declaredCapital,
}: {
  unreadSignalCount: number;
  declaredCapital: Centavos | null;
}) {
  const pathname = usePathname();

  return (
    <div className="pointer-events-none fixed top-[calc(var(--shell-header-height)+env(safe-area-inset-top)+var(--shell-float-inset))] left-[calc(var(--shell-float-inset)+env(safe-area-inset-left))] z-20 max-h-[calc(100dvh_-_var(--shell-header-height)_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_2*var(--shell-float-inset))] max-md:hidden">
      <nav
        aria-label={t.rail.navigationLabel}
        data-tour="dock"
        className="group/dock border-border bg-card pointer-events-auto flex max-h-[inherit] w-[var(--shell-dock-width)] flex-col gap-0.5 overflow-x-hidden overflow-y-auto rounded-[calc(var(--radius)*2)] border p-1.5 shadow-[var(--shell-float-shadow)] transition-[width] duration-[180ms] ease-out motion-reduce:transition-none lg:hover:w-[12.5rem] lg:has-[:focus-visible]:w-[12.5rem]"
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
                "relative flex h-9 shrink-0 items-center gap-2.5 rounded-[var(--radius)] px-2.5 text-[13px] transition-colors duration-[120ms]",
                active
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <destination.icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate opacity-0 transition-opacity duration-[120ms] motion-reduce:transition-none lg:group-hover/dock:opacity-100 lg:group-has-[:focus-visible]/dock:opacity-100">
                {destination.label}
              </span>
              {unread ? (
                <span className="bg-primary text-primary-foreground absolute top-0.5 left-5 min-w-4 rounded-full px-1 text-center font-mono text-[10px] leading-4 tabular-nums">
                  {formatUnreadCount(unreadSignalCount)}
                </span>
              ) : null}
            </Link>
          );
        })}

        <div className="border-border text-muted-foreground mt-1 hidden border-t px-2.5 pt-2 pb-1 text-xs whitespace-nowrap lg:group-hover/dock:block lg:group-has-[:focus-visible]/dock:block">
          <div>{t.rail.declaredCapital}</div>
          <DeclaredCapitalValue declaredCapital={declaredCapital} />
        </div>
      </nav>
    </div>
  );
}
