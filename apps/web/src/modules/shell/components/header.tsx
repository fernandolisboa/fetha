import { AccountMenu } from "./account-menu";
import { CommandSearch } from "./command-search";
import { MarketBar } from "./market-bar";
import type { SearchSources } from "../search";
import { t } from "../strings";

export function Header({ email, search }: { email: string; search: SearchSources }) {
  return (
    <header className="border-border bg-card flex h-12 items-center gap-2 border-b px-2 md:gap-4 md:px-4">
      <span className="text-[15px] font-semibold tracking-tight">{t.wordmark}</span>
      <CommandSearch search={search} />
      <MarketBar />
      <AccountMenu email={email} />
    </header>
  );
}
