import type { Instant } from "@fetha/contracts";
import type { EngineError, MarketView, Operation } from "../api";
import { sessionAtOrBefore } from "./calendar";
import { invalidInput } from "./errors";
import { resolveSeries } from "./resolve-series";

// Shared by markToMarket and proposeSettlement (ADR-0013 "Operations, positions and strategy
// versions", #25 addendum): expiry, underlying and role coherence, plus openedAt <= at. A
// leg's own missing series is left to that leg's own missing_instrument, reported later.
export function validateOperationCoherence(
  view: MarketView,
  operation: Operation,
  at: Instant,
  path: string,
): EngineError | null {
  const hasOptionLegs = operation.legs.some((leg) => leg.role !== "stock");

  if (!hasOptionLegs) {
    if (operation.expiry !== null) {
      return invalidInput(`${path}.expiry`, "a stock-only operation must not have an expiry");
    }
  } else if (operation.expiry === null) {
    return invalidInput(`${path}.expiry`, "an operation with option legs must have an expiry");
  }

  const atSession = sessionAtOrBefore(view.calendar, at)?.date ?? null;
  if (atSession !== null && operation.openedAt > atSession) {
    return invalidInput(
      `${path}.openedAt`,
      "an operation cannot be opened after the instant it is valued at",
    );
  }

  for (const [legIndex, leg] of operation.legs.entries()) {
    if (leg.role === "stock") {
      if (leg.ticker !== operation.underlying) {
        return invalidInput(
          `${path}.legs[${String(legIndex)}].ticker`,
          "a stock leg's ticker must match the operation's underlying",
        );
      }
      continue;
    }
    const series = resolveSeries(view, leg.ticker, at);
    if (!series) continue;
    if (series.expiry !== operation.expiry) {
      return invalidInput(
        `${path}.legs[${String(legIndex)}]`,
        "an option leg's listed expiry does not match the operation's expiry",
      );
    }
    if (series.underlying !== operation.underlying) {
      return invalidInput(
        `${path}.legs[${String(legIndex)}]`,
        "an option leg's listed underlying does not match the operation's underlying",
      );
    }
    if (series.right !== leg.role) {
      return invalidInput(
        `${path}.legs[${String(legIndex)}]`,
        "an option leg's role does not match its listed series' right",
      );
    }
  }
  return null;
}
