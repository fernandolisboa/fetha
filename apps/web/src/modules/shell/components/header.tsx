import { AccountMenu } from "./account-menu";
import { CommandSearch } from "./command-search";
import { MarketBar, type UsdBrlMarketBarQuote } from "./market-bar";
import type { SearchSources } from "../search";
import { t } from "../strings";

export function Header({
  email,
  search,
  usdBrl,
}: {
  email: string;
  search: SearchSources;
  usdBrl: UsdBrlMarketBarQuote | null;
}) {
  return (
    <header className="border-border bg-card -mt-[env(safe-area-inset-top)] -mr-[env(safe-area-inset-right)] -ml-[env(safe-area-inset-left)] flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 border-b pt-[env(safe-area-inset-top)] pr-[calc(0.5rem+env(safe-area-inset-right))] pl-[calc(0.5rem+env(safe-area-inset-left))] md:gap-4 md:pr-[calc(1rem+env(safe-area-inset-right))] md:pl-[calc(1rem+env(safe-area-inset-left))]">
      <span className="text-[15px] font-semibold tracking-tight">{t.wordmark}</span>
      <CommandSearch search={search} />
      <MarketBar usdBrl={usdBrl} />
      <AccountMenu email={email} />
    </header>
  );
}
