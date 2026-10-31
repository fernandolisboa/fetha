import { describe, expect, it } from "vitest";

import { marketDataStrings } from "./strings";

describe("option series history subtitle", () => {
  it("counts one session in the singular", () => {
    expect(marketDataStrings.en.optionSeries.history.subtitle(1)).toMatch(
      /^The last session with a record\./,
    );
    expect(marketDataStrings.ptBR.optionSeries.history.subtitle(1)).toMatch(
      /^Último pregão com registro\./,
    );
  });

  it("counts several sessions in the plural", () => {
    expect(marketDataStrings.en.optionSeries.history.subtitle(60)).toMatch(
      /^Last 60 sessions with a record\./,
    );
    expect(marketDataStrings.ptBR.optionSeries.history.subtitle(60)).toMatch(
      /^Últimos 60 pregões com registro\./,
    );
  });
});
