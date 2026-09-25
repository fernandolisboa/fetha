"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecimalString } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDecimal } from "@/lib/format/decimal";

import { confirmSettlementAction } from "../portfolio-actions";
import { t } from "../strings";

type OptionOutcome = "exercised" | "assigned" | "expired_worthless";

export interface SettlementLegView {
  ticker: string;
  role: "stock" | "call" | "put";
  side: "buy" | "sell";
  quantity: number;
  strike: DecimalString | null;
  intrinsicValue: DecimalString | null;
  proposed: OptionOutcome | "kept";
}

interface Choice {
  outcome: OptionOutcome;
  price: string;
  costs: string;
}

const labels = t.dashboard.settlements;

export function SettlementDialog({
  operationId,
  underlying,
  expiry,
  underlyingClose,
  legs,
}: {
  operationId: string;
  underlying: string;
  expiry: string;
  underlyingClose: DecimalString;
  legs: SettlementLegView[];
}) {
  const router = useRouter();
  const optionLegs = legs.filter((leg) => leg.proposed !== "kept");
  const initial = () =>
    Object.fromEntries(
      optionLegs.map((leg) => [
        leg.ticker,
        {
          outcome: leg.proposed as OptionOutcome,
          price: leg.strike ? formatDecimal(leg.strike) : "",
          costs: "",
        },
      ]),
    ) as Record<string, Choice>;
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(ticker: string, patch: Partial<Choice>) {
    setChoices((current) => {
      const existing = current[ticker];
      return existing ? { ...current, [ticker]: { ...existing, ...patch } } : current;
    });
  }

  function confirm() {
    setPending(true);
    setError(null);
    startTransition(() => {
      confirmSettlementAction({
        operationId,
        choices: optionLegs.map((leg) => ({
          ticker: leg.ticker,
          outcome: choices[leg.ticker]?.outcome ?? "expired_worthless",
          price: choices[leg.ticker]?.price ?? "",
          costs: choices[leg.ticker]?.costs ?? "",
        })),
      })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            setOpen(false);
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setChoices(initial());
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        {labels.review}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {labels.dialogTitle} <span className="font-mono uppercase">{underlying}</span> ·{" "}
            <span className="font-mono tabular-nums">{expiry}</span>
          </DialogTitle>
          <DialogDescription>
            {labels.underlyingClose}:{" "}
            <span className="font-mono tabular-nums">{formatDecimal(underlyingClose)}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col divide-y" style={{ borderColor: "var(--line-soft)" }}>
          {legs.map((leg) => {
            const choice = choices[leg.ticker];
            const allowed: OptionOutcome = leg.side === "buy" ? "exercised" : "assigned";
            return (
              <div key={leg.ticker} className="flex flex-col gap-2 py-3">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span>
                    <span style={{ color: leg.side === "buy" ? "var(--up)" : "var(--down)" }}>
                      {leg.side === "buy" ? t.dashboard.fills.buy : t.dashboard.fills.sell}
                    </span>{" "}
                    <span className="font-mono tabular-nums">{leg.quantity}</span>{" "}
                    <span className="font-mono uppercase">{leg.ticker}</span>
                  </span>
                  {leg.strike && (
                    <span className="text-muted-foreground font-mono text-[12px] tabular-nums">
                      {labels.strike} {formatDecimal(leg.strike)} · {labels.intrinsic}{" "}
                      {formatDecimal(leg.intrinsicValue ?? ("0" as DecimalString))}
                    </span>
                  )}
                </div>
                {!choice ? (
                  <p className="text-muted-foreground text-[12px]">{labels.outcomes.kept}</p>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_120px_120px] items-end gap-2">
                    <Select
                      value={choice.outcome}
                      onValueChange={(next) => {
                        if (next === allowed || next === "expired_worthless") {
                          update(leg.ticker, { outcome: next });
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-label={`${labels.outcome} ${leg.ticker}`}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={allowed}>{labels.outcomes[allowed]}</SelectItem>
                        <SelectItem value="expired_worthless">
                          {labels.outcomes.expired_worthless}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {choice.outcome !== "expired_worthless" && (
                      <>
                        <Input
                          aria-label={`${labels.stockPrice} ${leg.ticker}`}
                          value={choice.price}
                          inputMode="decimal"
                          className="font-mono tabular-nums"
                          onChange={(event) => {
                            update(leg.ticker, { price: event.target.value });
                          }}
                        />
                        <Input
                          aria-label={`${labels.costs} ${leg.ticker}`}
                          value={choice.costs}
                          placeholder="0,00"
                          inputMode="decimal"
                          className="font-mono tabular-nums"
                          onChange={(event) => {
                            update(leg.ticker, { costs: event.target.value });
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="text-[12px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" disabled={pending} onClick={confirm}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
