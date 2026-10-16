"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format/date-time";

import {
  listMyAccessLogAction,
  listMyAccessOriginsAction,
  type ListAccessLogActionResult,
} from "../actions";
import { accessEventSchema, type AccessEvent } from "../events";
import { t } from "../strings";
import { describeUserAgent } from "../user-agent";

const labels = t.accessLog;
const dialogLabels = labels.dialog;

const ALL_EVENTS = "all";
const ALL_ORIGINS = "all";

type AccessLogEntry = Extract<ListAccessLogActionResult, { status: "ok" }>["entries"][number];
type AccessLogCursor = Extract<ListAccessLogActionResult, { status: "ok" }>["nextCursor"];

interface Filters {
  from: string;
  to: string;
  event: AccessEvent | typeof ALL_EVENTS;
  ipAddress: string;
}

const eventItems = [
  { value: ALL_EVENTS, label: dialogLabels.allEvents },
  ...accessEventSchema.options.map((event) => ({ value: event, label: labels.events[event] })),
];

const emptyFilters: Filters = { from: "", to: "", event: ALL_EVENTS, ipAddress: ALL_ORIGINS };

function deviceLabel(userAgent: string | null): string {
  const { browser, os } = describeUserAgent(userAgent);
  const parts = [browser, os].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : labels.unknown;
}

function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.from !== "" ||
    filters.to !== "" ||
    filters.event !== ALL_EVENTS ||
    filters.ipAddress !== ALL_ORIGINS
  );
}

function toActionFilters(filters: Filters) {
  return {
    from: filters.from || undefined,
    to: filters.to || undefined,
    event: filters.event === ALL_EVENTS ? undefined : filters.event,
    ipAddress: filters.ipAddress === ALL_ORIGINS ? undefined : filters.ipAddress,
  };
}

export function AccessLogDialog() {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [origins, setOrigins] = useState<string[]>([]);
  const [entries, setEntries] = useState<AccessLogEntry[]>([]);
  const [cursor, setCursor] = useState<AccessLogCursor>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slower, superseded request (a stale filter or an
  // earlier page) overwriting the entries a newer one already set: only the
  // most recently started call is allowed to commit its result.
  const latestRequestId = useRef(0);

  async function load(nextFilters: Filters, nextCursor: AccessLogCursor) {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listMyAccessLogAction({
        ...toActionFilters(nextFilters),
        cursor: nextCursor
          ? { occurredAt: nextCursor.occurredAt.toISOString(), id: nextCursor.id }
          : undefined,
      });
      if (requestId !== latestRequestId.current) {
        return;
      }
      if (result.status === "error") {
        setError(dialogLabels.errors[result.error]);
        return;
      }
      setEntries((current) => (nextCursor ? [...current, ...result.entries] : result.entries));
      setCursor(result.nextCursor);
      if (result.total !== null) {
        setTotal(result.total);
      }
    } catch {
      if (requestId === latestRequestId.current) {
        setError(dialogLabels.errors.unavailable);
      }
    } finally {
      if (requestId === latestRequestId.current) {
        setLoading(false);
      }
    }
  }

  function reload(nextFilters: Filters) {
    latestRequestId.current += 1;
    setEntries([]);
    setCursor(null);
    setTotal(null);
    setLoading(false);
    if (nextFilters.from && nextFilters.to && nextFilters.from > nextFilters.to) {
      setError(dialogLabels.errors.range);
      return;
    }
    void load(nextFilters, null);
  }

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      return;
    }
    setFilters(emptyFilters);
    reload(emptyFilters);
    try {
      const originsResult = await listMyAccessOriginsAction();
      if (originsResult.status === "ok") {
        setOrigins(originsResult.origins);
      }
    } catch {
      // The origin filter is a convenience; the log itself still loads without it.
    }
  }

  function updateFilters(next: Partial<Filters>) {
    const updated = { ...filters, ...next };
    setFilters(updated);
    reload(updated);
  }

  const showEmpty = !loading && entries.length === 0 && !error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button type="button" variant="outline" size="sm" className="self-start" />}
      >
        {labels.viewAll}
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{dialogLabels.title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <div className="flex flex-col gap-1">
            <Label htmlFor="access-log-from">{dialogLabels.from}</Label>
            <Input
              id="access-log-from"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => {
                updateFilters({ from: event.target.value });
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="access-log-to">{dialogLabels.to}</Label>
            <Input
              id="access-log-to"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => {
                updateFilters({ to: event.target.value });
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{dialogLabels.eventFilter}</Label>
            <Select
              items={eventItems}
              value={filters.event}
              onValueChange={(next) => {
                updateFilters({
                  event:
                    next === ALL_EVENTS || accessEventSchema.options.includes(next as AccessEvent)
                      ? (next as AccessEvent | typeof ALL_EVENTS)
                      : ALL_EVENTS,
                });
              }}
            >
              <SelectTrigger aria-label={dialogLabels.eventFilter} className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EVENTS}>{dialogLabels.allEvents}</SelectItem>
                {accessEventSchema.options.map((event) => (
                  <SelectItem key={event} value={event}>
                    {labels.events[event]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{dialogLabels.originFilter}</Label>
            <Select
              items={[
                { value: ALL_ORIGINS, label: dialogLabels.allOrigins },
                ...origins.map((origin) => ({ value: origin, label: origin })),
              ]}
              value={filters.ipAddress}
              onValueChange={(next) => {
                updateFilters({ ipAddress: next ?? ALL_ORIGINS });
              }}
            >
              <SelectTrigger aria-label={dialogLabels.originFilter} className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ORIGINS}>{dialogLabels.allOrigins}</SelectItem>
                {origins.map((origin) => (
                  <SelectItem key={origin} value={origin}>
                    {origin}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasActiveFilters(filters) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters(emptyFilters);
                reload(emptyFilters);
              }}
            >
              {dialogLabels.clearFilters}
            </Button>
          ) : null}
        </div>

        {total !== null ? (
          <p className="text-muted-foreground font-mono text-[11px] tabular-nums">
            {dialogLabels.total(total)}
          </p>
        ) : null}

        <div
          role="region"
          aria-label={dialogLabels.title}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {showEmpty ? (
            <p className="text-muted-foreground text-[13px]">
              {hasActiveFilters(filters) ? dialogLabels.emptyFiltered : labels.empty}
            </p>
          ) : entries.length > 0 ? (
            <Table>
              <TableHeader className="bg-card sticky top-0 z-10">
                <TableRow>
                  <TableHead>{labels.event}</TableHead>
                  <TableHead>{labels.origin}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="py-1">
                      <div>{labels.events[entry.event]}</div>
                      <div className="text-muted-foreground font-mono text-[11px] tabular-nums">
                        {formatDateTime(entry.occurredAt)}
                      </div>
                    </TableCell>
                    <TableCell className="py-1">
                      <div className="font-mono tabular-nums">
                        {entry.ipAddress ?? labels.unknown}
                      </div>
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
          ) : null}
          {error ? (
            <div className="flex flex-wrap items-center gap-3 p-2">
              <p role="alert" className="text-[13px]" style={{ color: "var(--danger)" }}>
                {error}
              </p>
              {error === dialogLabels.errors.range ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void load(filters, cursor);
                  }}
                >
                  {dialogLabels.retry}
                </Button>
              )}
            </div>
          ) : null}
          {loading ? (
            <p className="text-muted-foreground p-2 text-[12px]">{dialogLabels.loading}</p>
          ) : null}
          {!loading && !error && cursor ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                void load(filters, cursor);
              }}
            >
              {dialogLabels.loadMore}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
