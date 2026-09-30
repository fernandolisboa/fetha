"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import type { DecimalString } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorNotice } from "@/components/error-notice";
import { formatDate, formatDateTime } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";

import { recordCorporateActionFactorAction } from "../corporate-action-actions";
import type { RecentCorporateActionFactor } from "../corporate-action-queries";
import { sessionDateToDisplayDate } from "../close-freshness";
import { t } from "../strings";

const labels = t.corporateActionPanel;

type Outcome =
  | { status: "ok"; factor: DecimalString; ratio: string }
  | { status: "forbidden" }
  | { status: "invalid_input" }
  | { status: "not_a_trading_session" }
  | { status: "unknown_ticker" }
  | { status: "client_error" };

function errorMessage(status: Exclude<Outcome["status"], "ok">): string {
  switch (status) {
    case "forbidden":
      return labels.forbidden;
    case "invalid_input":
      return labels.invalidInput;
    case "not_a_trading_session":
      return labels.notATradingSession;
    case "unknown_ticker":
      return labels.unknownTicker;
    case "client_error":
      return labels.unexpectedError;
  }
}

export function CorporateActionPanel({ factors }: { factors: RecentCorporateActionFactor[] }) {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [exDate, setExDate] = useState("");
  const [sharesBefore, setSharesBefore] = useState("");
  const [sharesAfter, setSharesAfter] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);

  function submit(): void {
    const parsedBefore = Number(sharesBefore);
    const parsedAfter = Number(sharesAfter);
    const ratio = labels.ratio(parsedBefore, parsedAfter);
    setPending(true);
    setResult(null);
    startTransition(() => {
      recordCorporateActionFactorAction({
        ticker: ticker.trim().toUpperCase(),
        exDate,
        sharesBefore: parsedBefore,
        sharesAfter: parsedAfter,
      })
        .then((response) => {
          if (response.status === "ok") {
            setResult({ status: "ok", factor: response.factor, ratio });
            router.refresh();
          } else {
            setResult(response);
          }
        })
        .catch(() => {
          setResult({ status: "client_error" });
        })
        .finally(() => {
          setPending(false);
        });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="corporate-action-ticker">{labels.tickerLabel}</Label>
          <Input
            id="corporate-action-ticker"
            required
            value={ticker}
            onChange={(event) => {
              setTicker(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="corporate-action-ex-date">{labels.exDateLabel}</Label>
          <Input
            id="corporate-action-ex-date"
            type="date"
            required
            value={exDate}
            onChange={(event) => {
              setExDate(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="corporate-action-shares-before">{labels.sharesBeforeLabel}</Label>
          <Input
            id="corporate-action-shares-before"
            type="number"
            min={1}
            step={1}
            required
            value={sharesBefore}
            onChange={(event) => {
              setSharesBefore(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="corporate-action-shares-after">{labels.sharesAfterLabel}</Label>
          <Input
            id="corporate-action-shares-after"
            type="number"
            min={1}
            step={1}
            required
            value={sharesAfter}
            onChange={(event) => {
              setSharesAfter(event.target.value);
            }}
          />
        </div>
      </div>

      <div>
        <Button onClick={submit} disabled={pending}>
          {pending ? labels.saving : labels.submit}
        </Button>
      </div>

      {result ? (
        result.status === "ok" ? (
          <p role="status" className="text-xs">
            {labels.saved(result.ratio, formatDecimal(result.factor, 8))}
          </p>
        ) : (
          <ErrorNotice>{errorMessage(result.status)}</ErrorNotice>
        )
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{labels.listTitle}</h3>
        {factors.length === 0 ? (
          <p className="text-muted-foreground text-xs">{labels.listEmpty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.tickerLabel}</TableHead>
                <TableHead>{labels.exDateLabel}</TableHead>
                <TableHead className="text-right">{labels.factorColumn}</TableHead>
                <TableHead className="text-right">{labels.recordedAtColumn}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {factors.map((factor) => (
                <TableRow key={`${factor.ticker}-${factor.exDate}`}>
                  <TableCell className="font-mono uppercase tabular-nums">
                    {factor.ticker}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {formatDate(sessionDateToDisplayDate(factor.exDate))}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatDecimal(factor.factor, 8)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatDateTime(new Date(factor.recordedAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
