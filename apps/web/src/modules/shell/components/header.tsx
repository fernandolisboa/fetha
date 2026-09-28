import { AccountMenu } from "./account-menu";
import { CommandSearch } from "./command-search";
import { MarketBar } from "./market-bar";
import type { SearchSources } from "../search";
import { t } from "../strings";

export function Header({ email, search }: { email: string; search: SearchSources }) {
  return (
    <header className="border-border bg-card -mt-[env(safe-area-inset-top)] flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 border-b px-2 pt-[env(safe-area-inset-top)] md:gap-4 md:px-4">
      <span className="text-[15px] font-semibold tracking-tight">{t.wordmark}</span>
      <CommandSearch search={search} />
      <MarketBar />
      <AccountMenu email={email} />
    </header>
  );
}
