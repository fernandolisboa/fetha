"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateRange } from "@/lib/format/date-range";
import { formatDateTime } from "@/lib/format/date-time";

import type { AccessLogGroup } from "../group-access-log";
import { t } from "../strings";
import { describeUserAgent } from "../user-agent";

const labels = t.accessLog;
const GROUPS_PER_PAGE = 10;

function deviceLabel(userAgent: string | null): string {
  const { browser, os } = describeUserAgent(userAgent);
  const parts = [browser, os].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : labels.unknown;
}

function occurrenceLabel(group: AccessLogGroup): string {
  return group.count > 1 ? formatDateRange(group.first, group.last) : formatDateTime(group.last);
}

export function AccessLogPanel({ groups }: { groups: AccessLogGroup[] }) {
  const [visibleCount, setVisibleCount] = useState(GROUPS_PER_PAGE);

  if (groups.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{labels.empty}</p>;
  }

  const visibleGroups = groups.slice(0, visibleCount);
  const hasMore = visibleCount < groups.length;

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.event}</TableHead>
            <TableHead>{labels.origin}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleGroups.map((group) => (
            <TableRow
              key={`${group.event}-${group.ipAddress ?? "none"}-${group.userAgent ?? "none"}-${group.last.toISOString()}`}
            >
              <TableCell className="py-1">
                <div>
                  {labels.events[group.event]}
                  {group.count > 1 ? (
                    <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                      {" "}
                      {group.count}×
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground font-mono text-[11px] tabular-nums">
                  {occurrenceLabel(group)}
                </div>
              </TableCell>
              <TableCell className="py-1">
                <div className="font-mono tabular-nums">{group.ipAddress ?? labels.unknown}</div>
                <div
                  className="text-muted-foreground text-[11px]"
                  title={group.userAgent ?? undefined}
                >
                  {deviceLabel(group.userAgent)}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setVisibleCount((count) => count + GROUPS_PER_PAGE);
          }}
        >
          {labels.showMore}
        </Button>
      ) : null}
    </div>
  );
}
