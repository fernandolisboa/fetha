"use client";

import { startTransition, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { setRailCollapsedAction } from "@/modules/preferences/client";

import { destinations } from "../destinations";
import { t } from "../strings";

export function Rail({
  initialCollapsed,
  unreadSignalCount,
}: {
  initialCollapsed: boolean;
  unreadSignalCount: number;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const pathname = usePathname();

  function toggle() {
    const previous = collapsed;
    const next = !previous;
    setCollapsed(next);
    startTransition(() => {
      void setRailCollapsedAction(next)
        .then((result) => {
          if (result.status === "error") {
            setCollapsed(previous);
          }
        })
        .catch(() => {
          setCollapsed(previous);
        });
    });
  }

  return (
    <nav
      aria-label={t.rail.navigationLabel}
      data-collapsed={collapsed}
      className={cn(
        "border-border bg-card flex flex-col gap-0.5 border-r py-3 transition-[width] duration-[180ms] max-md:hidden",
        collapsed ? "w-14 items-center px-1" : "w-[200px] px-2",
        "max-lg:w-14 max-lg:items-center max-lg:px-1",
      )}
    >
      {destinations().map((destination) => {
        const active = pathname === destination.href;
        return (
          <Link
            key={destination.href}
            href={destination.href}
            title={destination.label}
            className={cn(
              "flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-[13px]",
              active ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            <destination.icon className="size-4 shrink-0" aria-hidden />
            <span className={cn("flex-1 truncate max-lg:hidden", collapsed && "hidden")}>
              {destination.label}
            </span>
            {destination.showUnreadBadge && unreadSignalCount > 0 ? (
              <Badge
                variant="secondary"
                className={cn(
                  "bg-primary text-primary-foreground ml-auto font-mono text-[11px] tabular-nums max-lg:hidden",
                  collapsed && "hidden",
                )}
              >
                {unreadSignalCount}
              </Badge>
            ) : null}
          </Link>
        );
      })}

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? t.rail.expand : t.rail.collapse}
        className="text-muted-foreground hover:bg-secondary mt-2 flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-[13px] max-lg:hidden"
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4" aria-hidden />
        ) : (
          <PanelLeftClose className="size-4" aria-hidden />
        )}
      </button>

      <div className="text-muted-foreground mt-auto px-3 py-2 text-xs max-lg:hidden">
        <div>{t.rail.declaredCapital}</div>
        <div className="font-mono">{t.rail.capitalNotDeclared}</div>
      </div>
    </nav>
  );
}
