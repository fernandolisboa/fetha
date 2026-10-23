"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Centavos } from "@fetha/contracts";

import { cn } from "@/lib/utils";

import { DeclaredCapitalValue } from "./declared-capital";
import { destinations, formatUnreadCount, isActiveDestination } from "../destinations";
import { t } from "../strings";

// The Dock layout (ADR-0071) widens over the page instead of reflowing it, so
// the page keeps its width whether the labels show or not.
export function Dock({
  unreadSignalCount,
  declaredCapital,
}: {
  unreadSignalCount: number;
  declaredCapital: Centavos | null;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={t.rail.navigationLabel}
      data-tour="dock"
      className="group/dock border-border bg-card fixed top-[calc(var(--shell-header-height)+env(safe-area-inset-top)+var(--shell-float-inset))] left-[calc(var(--shell-float-inset)+env(safe-area-inset-left))] z-20 flex max-h-[calc(100dvh_-_var(--shell-header-height)_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_2*var(--shell-float-inset))] w-[var(--shell-dock-width)] [scrollbar-width:thin] flex-col gap-0.5 overflow-x-hidden overflow-y-auto rounded-[calc(var(--radius)*2)] border p-1.5 shadow-[var(--shell-float-shadow)] transition-[width] duration-[180ms] ease-out hover:w-[12.5rem] has-[:focus-visible]:w-[12.5rem] motion-reduce:transition-none max-md:hidden"
    >
      {destinations().map((destination) => {
        const active = isActiveDestination(pathname, destination.href);
        const unread = destination.showUnreadBadge && unreadSignalCount > 0;
        return (
          <Link
            key={destination.href}
            href={destination.href}
            aria-current={active ? "page" : undefined}
            onClick={blurAfterPointerClick}
            className={cn(
              "relative flex h-9 shrink-0 items-center gap-2.5 rounded-[var(--radius)] px-2.5 text-[13px] transition-colors duration-[120ms]",
              active
                ? "bg-accent text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <destination.icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate opacity-0 transition-opacity duration-[120ms] group-hover/dock:opacity-100 group-has-[:focus-visible]/dock:opacity-100 motion-reduce:transition-none">
              {destination.label}
            </span>
            {unread ? (
              <span className="bg-primary text-primary-foreground absolute top-0.5 right-0.5 min-w-4 rounded-full px-1 text-center font-mono text-[10px] leading-4 tabular-nums group-hover/dock:static group-hover/dock:ml-auto group-has-[:focus-visible]/dock:static group-has-[:focus-visible]/dock:ml-auto">
                {formatUnreadCount(unreadSignalCount)}
              </span>
            ) : null}
          </Link>
        );
      })}

      <div className="border-border text-muted-foreground mt-1 hidden border-t px-2.5 pt-2 pb-1 text-xs whitespace-nowrap group-hover/dock:block group-has-[:focus-visible]/dock:block">
        <div>{t.rail.declaredCapital}</div>
        <DeclaredCapitalValue declaredCapital={declaredCapital} />
      </div>
    </nav>
  );
}

// The link keeps focus after a client-side navigation, and the next key press
// makes a focused link match :focus-visible, which would hold the dock wide
// over the page. Enter (detail 0) keeps focus for keyboard users.
function blurAfterPointerClick(event: MouseEvent<HTMLAnchorElement>) {
  if (event.detail > 0) {
    event.currentTarget.blur();
  }
}
