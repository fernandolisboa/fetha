import { TriangleAlert } from "lucide-react";
import type { LimitBreach } from "@fetha/engine";

import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";

import { t } from "../strings";

function formatLimitValue(breach: LimitBreach): string {
  return breach.limit === "maxOpenOperations"
    ? formatDecimal(breach.value, 0)
    : formatPercent(breach.value);
}

export function RiskNotice({ breaches }: { breaches: LimitBreach[] }) {
  if (breaches.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-label={t.builder.riskNotice.title}
      data-testid="risk-notice"
      className="flex flex-col gap-2 rounded-[var(--radius)] border p-3"
      style={{ borderColor: "var(--warning)" }}
    >
      <p
        className="flex items-center gap-1.5 text-[13px] font-medium"
        style={{ color: "var(--warning)" }}
      >
        <TriangleAlert aria-hidden="true" className="size-4" />
        {t.builder.riskNotice.title}
      </p>
      <ul className="flex flex-col gap-1">
        {breaches.map((breach) => (
          <li
            key={breach.limit}
            className="text-muted-foreground font-mono text-[12px] tabular-nums"
          >
            {t.builder.riskNotice.limits[breach.limit]}: {formatLimitValue(breach)} &gt;{" "}
            {formatLimitValue({ ...breach, value: breach.allowed })}
          </li>
        ))}
      </ul>
    </div>
  );
}
