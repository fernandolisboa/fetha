import { describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";

import { lotLegsOf } from "./lot-legs";
import type { RadarLeg } from "./match";

const radarLeg = (ticker: string): RadarLeg => ({
  role: "call",
  side: "buy",
  ticker: tickerSchema.parse(ticker),
  strike: decimalStringSchema.parse("38.5"),
  expiry: sessionDateSchema.parse("2026-11-20"),
});
const quantity = quantitySchema.parse(100);
const price = decimalStringSchema.parse("1.20");

describe("lotLegsOf", () => {
  it("pairs each leg with its price and the series it resolved to", () => {
    expect(
      lotLegsOf(
        [{ ticker: tickerSchema.parse("PETRK385"), quantity }],
        [price],
        [radarLeg("PETRK385")],
      ),
    ).toEqual([{ ...radarLeg("PETRK385"), quantity, price }]);
  });

  it("refuses a leg with no price, a missing radar leg or a different ticker", () => {
    const leg = [{ ticker: tickerSchema.parse("PETRK385"), quantity }];
    expect(lotLegsOf(leg, [null], [radarLeg("PETRK385")])).toBeNull();
    expect(lotLegsOf(leg, [price], [])).toBeNull();
    expect(lotLegsOf(leg, [price], [radarLeg("PETRK405")])).toBeNull();
  });
});
