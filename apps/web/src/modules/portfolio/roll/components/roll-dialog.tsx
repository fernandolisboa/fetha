"use client";

import { Decimal } from "decimal.js";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { Centavos } from "@fetha/contracts";

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
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";
import { parsePtBrDecimal } from "@/lib/format/parse-decimal";

import { buildRollProposalAction, recordRollAction, type RollActionError } from "../roll-actions";
import type { RollOrder, RollProposal } from "../roll-proposal";
import { t } from "../../strings";

const labels = t.roll.dialog;

interface OrderEdit {
  price: string;
  costs: string;
}

function keyOf(order: RollOrder): string {
  return `${order.action}:${order.ticker}`;
}

function initialEdits(orders: readonly RollOrder[]): Record<string, OrderEdit> {
  return Object.fromEntries(
    orders.map((order) => [
      keyOf(order),
      { price: order.price ? formatDecimal(order.price) : "", costs: "" },
    ]),
  );
}

function errorLabel(error: RollActionError, ticker?: string): string {
  const errors = t.dashboard.errors;
  switch (error) {
    case "no_next_expiry":
      return errors.no_next_expiry(ticker ?? "");
    case "no_traded_series":
      return errors.no_traded_series(ticker ?? "");
    case "invalid":
      return errors.invalid_input;
    case "not_found":
    case "no_option_legs":
    case "no_expiry":
    case "no_data":
    case "unpriceable":
    case "conflict":
    case "not_a_session":
    case "rate_limited":
      return errors[error];
  }
}

function OrdersList({
  title,
  orders,
  edits,
  onChange,
}: {
  title: string;
  orders: readonly RollOrder[];
  edits: Record<string, OrderEdit>;
  onChange: (key: string, patch: Partial<OrderEdit>) => void;
}) {
  if (orders.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-[11px] uppercase">{title}</h3>
      <div className="flex flex-col divide-y" style={{ borderColor: "var(--line-soft)" }}>
        {orders.map((order) => {
          const key = keyOf(order);
          const edit = edits[key];
          return (
            <div key={key} className="flex flex-col gap-2 py-2">
              <span className="text-[13px]">
                <span style={{ color: order.side === "buy" ? "var(--up)" : "var(--down)" }}>
                  {order.side === "buy" ? t.dashboard.fills.buy : t.dashboard.fills.sell}
                </span>{" "}
                <span className="font-mono tabular-nums">{order.quantity}</span>{" "}
                <span className="font-mono uppercase">{order.ticker}</span>
              </span>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label={`${labels.price} ${order.ticker}`}
                  value={edit?.price ?? ""}
                  inputMode="decimal"
                  className="font-mono tabular-nums"
                  onChange={(event) => {
                    onChange(key, { price: event.target.value });
                  }}
                />
                <Input
                  aria-label={`${labels.costs} ${order.ticker}`}
                  value={edit?.costs ?? ""}
                  placeholder="0,00"
                  inputMode="decimal"
                  className="font-mono tabular-nums"
                  onChange={(event) => {
                    onChange(key, { costs: event.target.value });
                  }}
                />
              </div>
              {order.stale && (
                <p className="text-[11px]" style={{ color: "var(--warning)" }}>
                  {labels.stale(order.stale.session)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function signedBRL(value: Centavos): string {
  return value > 0 ? `+ ${formatBRL(value)}` : formatBRL(value);
}

// The net credit/debit recomputed from the prices the user actually edited (#382 review item
// 5), never the engine's own mark: shown as "antes de custos" since it excludes each order's
// costs, unlike the final recorded fills.
function editedNetCentavos(
  orders: readonly RollOrder[],
  edits: Record<string, OrderEdit>,
): Centavos | null {
  let total = new Decimal(0);
  for (const order of orders) {
    const raw = edits[keyOf(order)]?.price ?? "";
    const price = parsePtBrDecimal(raw, 6);
    if (!price) return null;
    const signed = order.side === "buy" ? price.negated() : price;
    total = total.plus(signed.times(order.quantity).times(100));
  }
  return total.toDecimalPlaces(0).toNumber() as Centavos;
}

export function RollDialog({
  operationId,
  underlying,
  today,
}: {
  operationId: string;
  underlying: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [proposal, setProposal] = useState<RollProposal | null>(null);
  const [edits, setEdits] = useState<Record<string, OrderEdit>>({});
  const [session, setSession] = useState(today);
  const [error, setError] = useState<string | null>(null);

  function updateOrder(key: string, patch: Partial<OrderEdit>) {
    setEdits((current) => ({
      ...current,
      [key]: { ...current[key], ...patch } as OrderEdit,
    }));
  }

  function load() {
    setLoading(true);
    setError(null);
    setProposal(null);
    startTransition(() => {
      buildRollProposalAction({ operationId })
        .then((result) => {
          setLoading(false);
          if (result.status === "ok") {
            setProposal(result.proposal);
            setEdits(initialEdits(result.proposal.orders));
          } else {
            setError(errorLabel(result.error, result.ticker));
          }
        })
        .catch(() => {
          setLoading(false);
          setError(t.dashboard.errors.unavailable);
        });
    });
  }

  function confirm() {
    if (!proposal) return;
    setPending(true);
    setError(null);
    const toInput = (order: RollOrder) => ({
      ticker: order.ticker,
      side: order.side,
      quantity: order.quantity,
      price: edits[keyOf(order)]?.price ?? "",
      costs: edits[keyOf(order)]?.costs ?? "",
    });
    startTransition(() => {
      recordRollAction({
        operationId,
        session,
        closingFills: proposal.orders.filter((order) => order.action === "close").map(toInput),
        openingFills: proposal.orders.filter((order) => order.action === "open").map(toInput),
      })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            setOpen(false);
            router.refresh();
          } else {
            setError(errorLabel(result.error));
          }
        })
        .catch(() => {
          setPending(false);
          setError(t.dashboard.errors.unavailable);
        });
    });
  }

  const editedNet = proposal ? editedNetCentavos(proposal.orders, edits) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        {t.roll.action}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {labels.title} <span className="font-mono uppercase">{underlying}</span>
          </DialogTitle>
          <DialogDescription>{labels.subtitle(underlying)}</DialogDescription>
        </DialogHeader>

        {loading && <p className="text-muted-foreground text-[13px]">{labels.building}</p>}
        {error && (
          <p role="alert" className="text-[12px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {proposal && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="roll-session">{labels.session}</Label>
              <Input
                id="roll-session"
                type="date"
                max={today}
                value={session}
                className="font-mono tabular-nums"
                onChange={(event) => {
                  setSession(event.target.value);
                }}
              />
            </div>
            <OrdersList
              title={labels.toClose}
              orders={proposal.orders.filter((order) => order.action === "close")}
              edits={edits}
              onChange={updateOrder}
            />
            <OrdersList
              title={labels.toOpen}
              orders={proposal.orders.filter((order) => order.action === "open")}
              edits={edits}
              onChange={updateOrder}
            />
            <div
              className="flex items-baseline justify-between border-t pt-2 text-[13px]"
              style={{ borderColor: "var(--line-soft)" }}
            >
              <span>
                {proposal.netCreditDebitCentavos >= 0 ? labels.netCredit : labels.netDebit}
              </span>
              <span
                className="font-mono tabular-nums"
                style={{
                  color: proposal.netCreditDebitCentavos >= 0 ? "var(--up)" : "var(--down)",
                }}
              >
                {signedBRL(proposal.netCreditDebitCentavos)}
              </span>
            </div>
            {editedNet !== null && (
              <div className="text-muted-foreground flex items-baseline justify-between text-[12px]">
                <span>{labels.netBeforeCosts}</span>
                <span className="font-mono tabular-nums">{signedBRL(editedNet)}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" disabled={!proposal || pending} onClick={confirm}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
