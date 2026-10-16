import Link from "next/link";
import { Bell } from "lucide-react";

import { MarketBar, type IbovMarketBarQuote, type UsdBrlMarketBarQuote } from "./market-bar";
import { formatUnreadCount } from "../destinations";
import { t } from "../strings";

// The Studio layout's foot (ADR-0069): the market bar leaves the header to
// make room for the destination tabs and sits here, next to the unread
// signal count. From 768px up only; under it both layouts share the phone
// shell (header market bar, bottom tab bar).
export function StatusBar({
  unreadSignalCount,
  usdBrl,
  ibov,
}: {
  unreadSignalCount: number;
  usdBrl: UsdBrlMarketBarQuote | null;
  ibov: IbovMarketBarQuote | null;
}) {
  return (
    <footer
      aria-label={t.statusBar.label}
      className="border-border bg-card fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--shell-status-height)+env(safe-area-inset-bottom))] items-center gap-4 border-t pr-[calc(1rem+env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[calc(1rem+env(safe-area-inset-left))] text-xs max-md:hidden"
    >
      <Link
        href="/sinais"
        className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5"
      >
        <Bell className="size-3.5" aria-hidden />
        {unreadSignalCount === 0 ? (
          t.statusBar.noUnreadSignals
        ) : (
          <span>
            <span className="text-foreground font-mono tabular-nums">
              {formatUnreadCount(unreadSignalCount)}
            </span>{" "}
            {t.statusBar.unreadSignalsNoun(unreadSignalCount)}
          </span>
        )}
      </Link>
      <MarketBar usdBrl={usdBrl} ibov={ibov} />
    </footer>
  );
}
