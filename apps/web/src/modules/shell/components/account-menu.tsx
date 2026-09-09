import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
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
        {/* A plain next/link, not a Base UI Menu item: MenuPrimitive.Item
            and MenuPrimitive.LinkItem both leave the popup's dismiss layer
            mounted after this link navigates, intercepting the triggering
            click and every click after (confirmed against a Vercel
            preview). SignOutButton below is the same shape: a plain form
            child, not a menu item, for the same reason. */}
        <Link
          href="/configuracoes"
          className="hover:bg-secondary rounded-[var(--radius)] px-1.5 py-1 text-sm"
        >
          {t.destinations.settings}
        </Link>
        <DropdownMenuSeparator />
        <SignOutButton />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
