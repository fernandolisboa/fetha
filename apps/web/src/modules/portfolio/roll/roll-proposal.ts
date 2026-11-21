import type { Centavos, DecimalString, SessionDate, Ticker } from "@fetha/contracts";
import type { Leg, OperationPricing, Side } from "@fetha/engine";

// A roll's two legs of pricing (#382): `closing` is the engine's own
// `priceOperation` on the held operation's legs with each side flipped (closing a short is a
// buy, closing a long is a sell), so its `netPremium` is the signed cash flow of closing today;
// `opening` is `priceOperation` on the next monthly expiry's legs, same structure and strike
// rule (ADR-0080, `exit-rules.ts`'s `resolveRollRule` already names which structures roll and
// when). The AI never produces either number: both come from the engine (CLAUDE.md principle 1).
export interface RollProposalInput {
  underlying: Ticker;
  closing: Pick<OperationPricing, "legs" | "netPremium">;
  opening: Pick<OperationPricing, "legs" | "netPremium">;
}

export type RollOrderAction = "close" | "open";

export interface RollOrder {
  action: RollOrderAction;
  ticker: Ticker;
  side: Side;
  quantity: Leg["quantity"];
  price: DecimalString | null;
  // The session the engine's own close is stale against, carried from `LegValuation.stale`
  // (#382): a dialog showing this order's price as current when it is actually
  // this many sessions old would misrepresent the net as live when it is not.
  stale: { session: SessionDate } | null;
}

export interface RollProposal {
  underlying: Ticker;
  orders: RollOrder[];
  // Positive: the roll is a net credit (money received); negative: a net debit (money paid),
  // the same sign convention `netPremium` already carries (DESIGN.md's `formatSignedBRL`).
  netCreditDebitCentavos: Centavos;
}

function ordersFor(action: RollOrderAction, pricing: Pick<OperationPricing, "legs">): RollOrder[] {
  return pricing.legs.map((valuation) => ({
    action,
    ticker: valuation.leg.ticker,
    side: valuation.leg.side,
    quantity: valuation.leg.quantity,
    price: valuation.price,
    stale: valuation.stale,
  }));
}

// The roll's orders and net credit/debit: never a new pricing computation, only an assembly of
// two pricings the caller already got from the engine.
export function buildRollProposal(input: RollProposalInput): RollProposal {
  return {
    underlying: input.underlying,
    orders: [...ordersFor("close", input.closing), ...ordersFor("open", input.opening)],
    netCreditDebitCentavos: (input.closing.netPremium + input.opening.netPremium) as Centavos,
  };
}
