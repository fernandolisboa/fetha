import { describe, expect, it } from "vitest";
import { structureSchema, tickerSchema, type Structure } from "@fetha/contracts";

import { legsFromTemplate, optionLegsOf } from "./template-legs";

const CALL_BUTTERFLY: Structure = structureSchema.parse({
  id: "call-butterfly",
  name: "Borboleta com calls",
  expiry: "shared",
  legs: [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 2, strikeRank: 2 },
    { role: "call", side: "buy", ratio: 1, strikeRank: 3 },
  ],
});

const COVERED_CALL: Structure = structureSchema.parse({
  id: "covered-call",
  name: "Covered call",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
  ],
});

const UNDERLYING = tickerSchema.parse("PETR4");

describe("optionLegsOf", () => {
  it("drops the stock leg, keeping only the ones a strike can adjust", () => {
    expect(optionLegsOf(COVERED_CALL)).toEqual([
      { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
    ]);
  });
});

describe("legsFromTemplate", () => {
  it("scales every leg's quantity by its own ratio, not a flat lots*100 (the core ratio fix)", () => {
    const legs = legsFromTemplate(
      CALL_BUTTERFLY,
      UNDERLYING,
      [
        tickerSchema.parse("PETRC034"),
        tickerSchema.parse("PETRC036"),
        tickerSchema.parse("PETRC038"),
      ],
      2,
    );
    expect(legs?.map((leg) => leg.quantity)).toEqual([200, 400, 200]);
    expect(legs?.map((leg) => ({ role: leg.role, side: leg.side }))).toEqual([
      { role: "call", side: "buy" },
      { role: "call", side: "sell" },
      { role: "call", side: "buy" },
    ]);
  });

  it("fills a stock leg's ticker with the underlying, never from the client", () => {
    const legs = legsFromTemplate(COVERED_CALL, UNDERLYING, [tickerSchema.parse("PETRC036")], 3);
    expect(legs?.[0]).toMatchObject({ role: "stock", ticker: UNDERLYING, quantity: 300 });
    expect(legs?.[1]).toMatchObject({ ticker: "PETRC036", quantity: 300 });
  });

  it("returns null when the ticker count does not match the template's option legs", () => {
    const legs = legsFromTemplate(
      CALL_BUTTERFLY,
      UNDERLYING,
      [tickerSchema.parse("PETRC034"), tickerSchema.parse("PETRC036")],
      1,
    );
    expect(legs).toBeNull();
  });
});
