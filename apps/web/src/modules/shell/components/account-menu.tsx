import type { Theme } from "@fetha/contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemePicker } from "@/modules/preferences";
import { SignOutButton } from "@/modules/auth";

import { t } from "../strings";

export function AccountMenu({ email, theme }: { email: string; theme: Theme }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.accountMenu.open}
        className="border-border bg-secondary flex h-7 items-center gap-2 rounded-full border px-2 text-xs"
      >
        <span className="bg-accent text-foreground flex size-5 items-center justify-center rounded-full text-[10px] font-medium uppercase">
          {email.slice(0, 1)}
        </span>
        <span className="text-muted-foreground max-w-40 truncate">{email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3">
        <DropdownMenuLabel className="text-muted-foreground px-0 text-xs font-normal">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <p className="mb-2 text-xs font-medium">{t.accountMenu.theme}</p>
        <ThemePicker current={theme} />
        <DropdownMenuSeparator />
        <SignOutButton />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
