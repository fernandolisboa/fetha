import type { Instant } from "@fetha/contracts";
import type { EngineError, MarketView, Operation } from "../api";
import { sessionAtOrBefore } from "./calendar";
import { resolveSeries } from "./resolve-series";

function invalidInput(path: string, message: string): EngineError {
  return { code: "invalid_input", path, message };
}

// ADR-0013 "Operations, positions and strategy versions": the engine checks Operation.expiry
// coherence wherever an Operation comes in. markToMarket and proposeSettlement share this
// check (ADR-0013's #25 addendum): a stock-only operation must carry no expiry, an operation
// with option legs must carry one, every stock leg's ticker must match the operation's
// underlying, every option leg whose series is visible in the view must list the operation's
// own underlying and expiry and the leg's own role as its right, and the operation cannot
// have been opened after the instant it is being valued at (round 1 item 7: a leg's own
// missing-series case is left to that leg's own `missing_instrument`, reported later).
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
