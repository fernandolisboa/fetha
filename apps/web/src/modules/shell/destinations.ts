import { Eye, Bell, TrendingUp, Wallet, BookOpen, Settings, type LucideIcon } from "lucide-react";

import { t } from "./strings";

export interface Destination {
  href: string;
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
