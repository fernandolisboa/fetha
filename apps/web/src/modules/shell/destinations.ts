import { Eye, Bell, TrendingUp, Wallet, BookOpen, Settings, type LucideIcon } from "lucide-react";

import { t } from "./strings";

export type DestinationHref =
  "/" | "/sinais" | "/estrategias" | "/carteira" | "/diario" | "/configuracoes";

export interface Destination {
  href: DestinationHref;
  label: string;
  icon: LucideIcon;
  showUnreadBadge?: boolean;
}

export function destinations(): Destination[] {
  return [
    { href: "/", label: t.destinations.watchlist, icon: Eye },
    { href: "/sinais", label: t.destinations.signals, icon: Bell, showUnreadBadge: true },
    { href: "/estrategias", label: t.destinations.strategies, icon: TrendingUp },
    { href: "/carteira", label: t.destinations.portfolio, icon: Wallet },
    { href: "/diario", label: t.destinations.journal, icon: BookOpen },
    { href: "/configuracoes", label: t.destinations.settings, icon: Settings },
  ];
}

// A destination stays current on its own sub-pages (`/estrategias/<id>`,
// `/carteira/nova-operacao`); the watchlist at `/` only on itself, or every
// page would light it.
export function isActiveDestination(pathname: string, href: DestinationHref): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
