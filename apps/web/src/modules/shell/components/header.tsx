import type { ReactNode } from "react";

import { AccountMenu } from "./account-menu";
import { CommandSearch } from "./command-search";
import { MarketBar, type IbovMarketBarQuote, type UsdBrlMarketBarQuote } from "./market-bar";
import type { SearchSources } from "../search";
import { t } from "../strings";

// `navigation` is the Studio layout's destination tabs (ADR-0069): with them
// the market bar moves to the status bar from 768px up, and stays here only
// for the phone shell both layouts share.
export function Header({
  email,
  search,
  usdBrl,
  ibov,
  navigation,
}: {
  email: string;
  search: SearchSources;
  usdBrl: UsdBrlMarketBarQuote | null;
  ibov: IbovMarketBarQuote | null;
  navigation?: ReactNode;
}) {
  return (
    <header className="border-border bg-card -mt-[env(safe-area-inset-top)] -mr-[env(safe-area-inset-right)] -ml-[env(safe-area-inset-left)] flex h-[calc(var(--shell-header-height)+env(safe-area-inset-top))] items-center gap-2 border-b pt-[env(safe-area-inset-top)] pr-[calc(0.5rem+env(safe-area-inset-right))] pl-[calc(0.5rem+env(safe-area-inset-left))] md:sticky md:top-0 md:z-30 md:gap-4 md:pr-[calc(1rem+env(safe-area-inset-right))] md:pl-[calc(1rem+env(safe-area-inset-left))]">
      <span className="text-[15px] font-semibold tracking-tight">{t.wordmark}</span>
      {navigation}
      {navigation ? (
        <span className="flex min-w-0 shrink md:ml-auto">
          <CommandSearch search={search} />
        </span>
      ) : (
        <CommandSearch search={search} />
      )}
      <span className={navigation ? "contents md:hidden" : "contents"}>
        <MarketBar usdBrl={usdBrl} ibov={ibov} />
      </span>
      <AccountMenu email={email} />
    </header>
  );
}
