"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { executePlanAction, planExecutionPrefillAction } from "../execute-plan-action";
import { t } from "../strings";

interface FillDraft {
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: string;
  costs: string;
}

function isKnownError(error: string): error is keyof typeof t.execute.errors {
  return error in t.execute.errors;
}

export function ExecutePlanDialog({
  contemplatedOperationId,
}: {
  contemplatedOperationId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [session, setSession] = useState("");
  const [fills, setFills] = useState<FillDraft[]>([]);
  const labels = t.execute;

  function openDialog() {
    setOpen(true);
    setError(null);
    setLoading(true);
    startTransition(() => {
      planExecutionPrefillAction(contemplatedOperationId)
        .then((result) => {
          setLoading(false);
          if (result.status === "ok") {
            setToday(result.today);
            setSession(result.today);
            setFills(
              result.legs.map((leg) => ({
                ticker: leg.ticker,
                side: leg.side,
                quantity: leg.quantity,
                price: leg.price ?? "",
                costs: "",
              })),
            );
          } else {
            setError(
              result.error === "invalid"
                ? labels.errors.invalid_input
                : labels.errors[result.error],
            );
          }
        })
        .catch(() => {
          setLoading(false);
          setError(labels.errors.unavailable);
        });
    });
  }

  function submit() {
    setPending(true);
    setError(null);
    startTransition(() => {
      executePlanAction({
        contemplatedOperationId,
        session,
        fills: fills.map((fill) => ({
          ticker: fill.ticker,
          quantity: fill.quantity,
          price: fill.price,
          costs: fill.costs,
        })),
      })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            setOpen(false);
            router.refresh();
          } else {
            setError(
              isKnownError(result.error) ? labels.errors[result.error] : labels.errors.unavailable,
            );
          }
        })
        .catch(() => {
          setPending(false);
          setError(labels.errors.unavailable);
        });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
        if (next) openDialog();
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        {labels.button}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.dialogTitle}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-muted-foreground text-[13px]">...</p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="execute-session">{labels.date}</Label>
              <Input
                id="execute-session"
                type="date"
                required
                value={session}
                max={today}
                onChange={(event) => {
                  setSession(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-3">
              {fills.map((fill, index) => (
                <div key={fill.ticker} className="grid grid-cols-6 items-end gap-2">
                  <div className="col-span-6 flex items-center justify-between text-[12px]">
                    <span className="font-mono uppercase">{fill.ticker}</span>
                    <span className="text-muted-foreground">
                      {fill.side === "buy" ? labels.buy : labels.sell}
                    </span>
                  </div>
                  <div className="col-span-2 flex flex-col gap-1">
                    <Label htmlFor={`execute-quantity-${String(index)}`}>{labels.quantity}</Label>
                    <Input
                      id={`execute-quantity-${String(index)}`}
                      required
                      type="number"
                      min={1}
                      step={1}
                      className="font-mono tabular-nums"
                      value={fill.quantity}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setFills((previous) =>
                          previous.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, quantity: value } : row,
                          ),
                        );
                      }}
                    />
                  </div>
                  <div className="col-span-2 flex flex-col gap-1">
                    <Label htmlFor={`execute-price-${String(index)}`}>{labels.price}</Label>
                    <Input
                      id={`execute-price-${String(index)}`}
                      required
                      inputMode="decimal"
                      className="font-mono tabular-nums"
                      value={fill.price}
                      onChange={(event) => {
                        const value = event.target.value;
                        setFills((previous) =>
                          previous.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, price: value } : row,
                          ),
                        );
                      }}
                    />
                  </div>
                  <div className="col-span-2 flex flex-col gap-1">
                    <Label htmlFor={`execute-costs-${String(index)}`}>{labels.costs}</Label>
                    <Input
                      id={`execute-costs-${String(index)}`}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="font-mono tabular-nums"
                      value={fill.costs}
                      onChange={(event) => {
                        const value = event.target.value;
                        setFills((previous) =>
                          previous.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, costs: value } : row,
                          ),
                        );
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-[12px]" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending || fills.length === 0}>
                {pending ? labels.submitting : labels.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
