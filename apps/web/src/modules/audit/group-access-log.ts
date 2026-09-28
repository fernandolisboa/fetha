import type { AccessLogEntry } from "./access-log-repository";
import type { AccessEvent } from "./events";

export interface AccessLogGroup {
  event: AccessEvent;
  ipAddress: string | null;
  userAgent: string | null;
  count: number;
  first: Date;
  last: Date;
}

function sameOrigin(a: AccessLogEntry, b: AccessLogGroup): boolean {
  return a.event === b.event && a.ipAddress === b.ipAddress && a.userAgent === b.userAgent;
}

export function groupAccessLog(entries: readonly AccessLogEntry[]): AccessLogGroup[] {
  const groups: AccessLogGroup[] = [];

  for (const entry of entries) {
    const current = groups.at(-1);
    if (current && sameOrigin(entry, current)) {
      current.count += 1;
      current.first = entry.occurredAt;
      continue;
    }
    groups.push({
      event: entry.event,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      count: 1,
      first: entry.occurredAt,
      last: entry.occurredAt,
    });
  }

  return groups;
}
