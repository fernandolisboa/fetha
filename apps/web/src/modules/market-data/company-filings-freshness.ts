import { closeFreshnessKind, sessionDateToDisplayDate } from "./close-freshness";
import { formatDate } from "@/lib/format/date-time";
import { t } from "./strings";

const labels = t.companyFilings;

// The newest delivery across every stored filing is the CVM file's own cutoff
// (docs/adr/0060), phrased like the market bar's close freshness.
export function companyFilingsFreshness(
  latestDelivery: string | undefined,
  now: Date,
): string | null {
  if (latestDelivery === undefined) {
    return null;
  }
  const freshness = closeFreshnessKind(latestDelivery, now);
  switch (freshness.kind) {
    case "today":
      return labels.deliveredUntilToday;
    case "yesterday":
      return labels.deliveredUntilYesterday;
    case "older":
      return labels.deliveredUntil(formatDate(sessionDateToDisplayDate(freshness.session)));
  }
}
