import { AccountMenu } from "./account-menu";
import { CommandSearch } from "./command-search";
import { MarketBar } from "./market-bar";
import { t } from "../strings";

export function Header({ email }: { email: string }) {
  return (
    <header className="border-border bg-card flex h-12 items-center gap-4 border-b px-4">
      <span className="text-[15px] font-semibold tracking-tight">{t.wordmark}</span>
      <CommandSearch />
      <MarketBar />
      <AccountMenu email={email} />
    </header>
  );
}
