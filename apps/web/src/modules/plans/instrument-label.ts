import { formatPriceBRL } from "@/lib/format/brl";
import { formatSessionDate } from "@/lib/format/date-time";

import type { PlanLegSeries } from "./actions";
import { t } from "./strings";

// Names the underlying, not the option's own series ticker (round 4 review): "Call de PETR4,
// strike R$ 36,00, vence 16/01/2027", the way the ticket's own example reads an order — the
// series' own code (e.g. PETRL44) is a separate fact, rendered as its own line by the caller, not
// folded into this label.
export function instrumentLabel(
  leg: { role: "stock" | "call" | "put"; ticker: string },
  series: PlanLegSeries | undefined,
): string {
  if (leg.role === "stock" || !series) return t.screen.orders.stock(leg.ticker);
  const strike = formatPriceBRL(series.strike);
  const expiry = formatSessionDate(series.expiry);
  return leg.role === "call"
    ? t.screen.orders.call(series.underlying, strike, expiry)
    : t.screen.orders.put(series.underlying, strike, expiry);
}
