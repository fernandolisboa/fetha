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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { recordFillAction } from "../portfolio-actions";
import { t } from "../strings";

type Side = "buy" | "sell";

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

export function RecordFillDialog({ today }: { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>("buy");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = t.dashboard.recordDialog;

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setPending(true);
    setError(null);
    startTransition(() => {
      recordFillAction({
        ticker: field(data, "ticker"),
        side,
        quantity: field(data, "quantity"),
        price: field(data, "price"),
        session: field(data, "session"),
        costs: field(data, "costs"),
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
        if (!next) setError(null);
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        {t.dashboard.recordFill}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="fill-ticker">{labels.instrument}</Label>
              <Input
                id="fill-ticker"
                name="ticker"
                required
                autoComplete="off"
                className="font-mono uppercase"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{labels.side}</Label>
              <Select
                value={side}
                onValueChange={(next) => {
                  if (next === "buy" || next === "sell") setSide(next);
                }}
              >
                <SelectTrigger aria-label={labels.side} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">{t.dashboard.fills.buy}</SelectItem>
                  <SelectItem value="sell">{t.dashboard.fills.sell}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="fill-quantity">{labels.quantity}</Label>
              <Input
                id="fill-quantity"
                name="quantity"
                required
                inputMode="numeric"
                className="font-mono tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="fill-price">{labels.price}</Label>
              <Input
                id="fill-price"
                name="price"
                required
                inputMode="decimal"
                placeholder="38,42"
                className="font-mono tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="fill-session">{labels.date}</Label>
              <Input
                id="fill-session"
                name="session"
                type="date"
                required
                max={today}
                defaultValue={today}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="fill-costs">{labels.costs}</Label>
              <Input
                id="fill-costs"
                name="costs"
                inputMode="decimal"
                placeholder="0,00"
                className="font-mono tabular-nums"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-[12px]" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {labels.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
