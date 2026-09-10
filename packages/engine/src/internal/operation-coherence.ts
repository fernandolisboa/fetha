import type { Instant } from "@fetha/contracts";
import type { EngineError, MarketView, Operation } from "../api";
import { resolveSeries } from "./resolve-series";

function invalidInput(path: string, message: string): EngineError {
  return { code: "invalid_input", path, message };
}

// ADR-0013 "Operations, positions and strategy versions": the engine checks Operation.expiry
// coherence wherever an Operation comes in. markToMarket and proposeSettlement share this
// check (ADR-0013's #25 addendum): a stock-only operation must carry no expiry, an operation
// with option legs must carry one, every stock leg's ticker must match the operation's
// underlying, and every option leg whose series is visible in the view must expire on the
// operation's own expiry.
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
    if (series && series.expiry !== operation.expiry) {
      return invalidInput(
        `${path}.legs[${String(legIndex)}]`,
        "an option leg's listed expiry does not match the operation's expiry",
      );
    }
  }
  return null;
}
