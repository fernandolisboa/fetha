import { ExternalLink } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format/date-time";

import { closeFreshnessKind, sessionDateToDisplayDate } from "../close-freshness";
import type {
  CompanyFilingRow,
  RecentCompanyFilings,
} from "../repositories/company-filing-repository";
import { t } from "../strings";

const labels = t.companyFilings;

function displayDate(isoDate: string): string {
  return formatDate(sessionDateToDisplayDate(isoDate));
}

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
      return labels.deliveredUntil(displayDate(freshness.session));
  }
}

function headlineOf(filing: CompanyFilingRow): string {
  return filing.subject || filing.kind || labels.category[filing.category];
}

export function CompanyFilingsList({
  recent,
  loaded,
}: {
  recent: RecentCompanyFilings;
  loaded: boolean;
}) {
  if (!loaded) {
    return <p className="text-muted-foreground text-[13px]">{labels.notLoaded}</p>;
  }
  if (!recent.mapped) {
    return <p className="text-muted-foreground text-[13px]">{labels.notACompany}</p>;
  }
  if (recent.filings.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{labels.empty}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">{labels.deliveredOn}</TableHead>
          <TableHead className="hidden w-48 sm:table-cell">{labels.categoryColumn}</TableHead>
          <TableHead>{labels.subject}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {recent.filings.map((filing) => (
          <TableRow key={filing.protocol}>
            <TableCell className="align-top font-mono tabular-nums">
              {displayDate(filing.deliveredOn)}
            </TableCell>
            <TableCell className="hidden align-top sm:table-cell">
              {labels.category[filing.category]}
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <a
                href={filing.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary inline-flex items-start gap-1 underline-offset-4 hover:underline"
                aria-label={labels.openDocument(headlineOf(filing))}
              >
                <span className="line-clamp-2">{headlineOf(filing)}</span>
                <ExternalLink aria-hidden className="mt-0.5 size-3 shrink-0" />
              </a>
              <p className="text-muted-foreground line-clamp-1 text-xs sm:hidden">
                {labels.category[filing.category]}
              </p>
              {filing.kind && filing.subject && (
                <p className="text-muted-foreground line-clamp-1 hidden text-xs sm:block">
                  {filing.kind}
                </p>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
