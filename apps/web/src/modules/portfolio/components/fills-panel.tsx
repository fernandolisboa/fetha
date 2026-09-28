"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecimalString } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";
import type { Centavos } from "@fetha/contracts";

import {
  deleteFillAction,
  groupFillsAction,
  type PortfolioActionResult,
} from "../portfolio-actions";
import { t } from "../strings";

export interface FillRow {
  id: string;
  date: string;
  side: "buy" | "sell";
  ticker: string;
  quantity: number;
  price: DecimalString;
  costsCentavos: number;
  source: "manual" | "b3_import" | "settlement";
  operationLabel: string | null;
}

export interface OpenOperationOption {
  id: string;
  label: string;
}

const labels = t.dashboard.fills;

export function FillsPanel({
  fills,
  openOperations,
}: {
  fills: FillRow[];
  openOperations: OpenOperationOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<PortfolioActionResult>) {
    setPending(true);
    setError(null);
    startTransition(() => {
      action()
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            setSelected(new Set());
            setTarget("");
            router.refresh();
          } else {
            setError(t.dashboard.errors[result.error]);
          }
        })
        .catch(() => {
          setPending(false);
          setError(t.dashboard.errors.unavailable);
        });
    });
  }

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  if (fills.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{labels.empty}</p>;
  }

  const fillIds = [...selected];
  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-[12px] tabular-nums">
            {selected.size} {labels.selected}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              run(() => groupFillsAction({ fillIds, operationId: null }));
            }}
          >
            {labels.groupNew}
          </Button>
          {openOperations.length > 0 && (
            <>
              <Select
                value={target}
                onValueChange={(next) => {
                  if (typeof next === "string") setTarget(next);
                }}
              >
                <SelectTrigger size="sm" aria-label={labels.pickOperation} className="min-w-48">
                  <SelectValue placeholder={labels.pickOperation} />
                </SelectTrigger>
                <SelectContent>
                  {openOperations.map((operation) => (
                    <SelectItem key={operation.id} value={operation.id}>
                      {operation.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || target === ""}
                onClick={() => {
                  run(() => groupFillsAction({ fillIds, operationId: target }));
                }}
              >
                {labels.addTo}
              </Button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12px]" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{labels.date}</TableHead>
            <TableHead>{labels.side}</TableHead>
            <TableHead>{labels.instrument}</TableHead>
            <TableHead className="text-right">{labels.quantity}</TableHead>
            <TableHead className="text-right">{labels.price}</TableHead>
            <TableHead className="text-right">{labels.costs}</TableHead>
            <TableHead>{labels.source}</TableHead>
            <TableHead>{labels.operation}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {fills.map((fill) => {
            const assignable = fill.operationLabel === null;
            return (
              <TableRow key={fill.id}>
                <TableCell>
                  {assignable && (
                    <Checkbox
                      aria-label={`${labels.select} ${fill.ticker} ${fill.date}`}
                      checked={selected.has(fill.id)}
                      onCheckedChange={(checked) => {
                        toggle(fill.id, checked);
                      }}
                    />
                  )}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{fill.date}</TableCell>
                <TableCell style={{ color: fill.side === "buy" ? "var(--up)" : "var(--down)" }}>
                  {fill.side === "buy" ? labels.buy : labels.sell}
                </TableCell>
                <TableCell className="font-mono uppercase">{fill.ticker}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatDecimal(String(fill.quantity) as DecimalString, 0)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatDecimal(fill.price)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fill.costsCentavos === 0 ? "—" : formatBRL(fill.costsCentavos as Centavos)}
                </TableCell>
                <TableCell className="text-muted-foreground text-[12px]">
                  {labels.sources[fill.source]}
                </TableCell>
                <TableCell className="font-mono text-[12px] uppercase">
                  {fill.operationLabel ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right">
                  {assignable && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        run(() => deleteFillAction(fill.id));
                      }}
                    >
                      {labels.delete}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
