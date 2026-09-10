import type { CloseFreshness } from "@/modules/market-data/client";
import { sessionDateToDisplayDate } from "@/modules/market-data/client";
import { formatDate } from "@/lib/format/date-time";

import { t } from "./strings";

// Renders the market bar's freshness phrase from a typed, timezone-aware
// value (market-data's `closeFreshnessKind`) rather than baking pt-BR copy
// into the data module: the market bar recomputes this against a live
// `now` client-side (#13), so the phrase has to be free to recompute too.
export function closeFreshnessPhrase(freshness: CloseFreshness): string {
  switch (freshness.kind) {
    case "today":
      return t.marketBar.closeFreshnessToday;
    case "yesterday":
      return t.marketBar.closeFreshnessYesterday;
    case "older":
      return t.marketBar.closeFreshnessOlder(
        formatDate(sessionDateToDisplayDate(freshness.session)),
      );
  }
}
