import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format/date-time";

import type { AccessLogEntry } from "../access-log-repository";
import { t } from "../strings";
import { describeUserAgent } from "../user-agent";

const labels = t.accessLog;

function deviceLabel(userAgent: string | null): string {
  const { browser, os } = describeUserAgent(userAgent);
  const parts = [browser, os].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : labels.unknown;
}

export function AccessLogPanel({ entries }: { entries: AccessLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{labels.empty}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{labels.event}</TableHead>
          <TableHead>{labels.origin}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>
              <div>{labels.events[entry.event]}</div>
              <div className="text-muted-foreground font-mono text-[11px] tabular-nums">
                {formatDateTime(entry.occurredAt)}
              </div>
            </TableCell>
            <TableCell>
              <div className="font-mono tabular-nums">{entry.ipAddress ?? labels.unknown}</div>
              <div
                className="text-muted-foreground text-[11px]"
                title={entry.userAgent ?? undefined}
              >
                {deviceLabel(entry.userAgent)}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
