import { TriangleAlert } from "lucide-react";
import type { LimitBreach } from "@fetha/engine";

import { formatDecimal } from "@/lib/format/decimal";

import { t } from "../strings";

export function RiskNotice({ breaches }: { breaches: LimitBreach[] }) {
  if (breaches.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
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
        {breaches.map((breach) => {
          const decimals = breach.limit === "maxOpenOperations" ? 0 : 4;
          return (
            <li
              key={breach.limit}
              className="text-muted-foreground font-mono text-[12px] tabular-nums"
            >
              {t.builder.riskNotice.limits[breach.limit]}: {formatDecimal(breach.value, decimals)}{" "}
              &gt; {formatDecimal(breach.allowed, decimals)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
