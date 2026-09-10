import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutButton } from "@/modules/auth";

import { t } from "../strings";

export function AccountMenu({ email }: { email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.accountMenu.open}
        className="border-border bg-secondary flex h-8 items-center gap-2 rounded-full border px-2 text-xs"
      >
        <span className="bg-accent text-foreground flex size-5 items-center justify-center rounded-full text-[11px] font-medium uppercase">
          {email.slice(0, 1)}
        </span>
        <span className="text-muted-foreground max-w-40 truncate">{email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-3">
        <DropdownMenuLabel className="text-muted-foreground px-0 text-xs font-normal">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<Link href="/configuracoes" />} className="px-0">
          {t.destinations.settings}
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <SignOutButton />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
