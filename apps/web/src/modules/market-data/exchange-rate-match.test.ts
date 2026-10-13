import { describe, expect, it } from "vitest";

import { exchangeRateHref, matchExchangeRates } from "./exchange-rate-match";

describe("matchExchangeRates", () => {
  it("matches the pair code by prefix, case-insensitively", () => {
    expect(matchExchangeRates("usd")).toEqual([{ pair: "USDBRL", label: "Dólar americano" }]);
    expect(matchExchangeRates("USDBRL")).toEqual([{ pair: "USDBRL", label: "Dólar americano" }]);
    expect(matchExchangeRates("eur")).toEqual([{ pair: "EURBRL", label: "Euro" }]);
  });

  it("matches the Portuguese alias, accent-insensitively", () => {
    expect(matchExchangeRates("dólar")).toEqual([{ pair: "USDBRL", label: "Dólar americano" }]);
    expect(matchExchangeRates("dolar")).toEqual([{ pair: "USDBRL", label: "Dólar americano" }]);
    expect(matchExchangeRates("DOLAR")).toEqual([{ pair: "USDBRL", label: "Dólar americano" }]);
    expect(matchExchangeRates("euro")).toEqual([{ pair: "EURBRL", label: "Euro" }]);
  });

  it("matches a short alias prefix", () => {
    expect(matchExchangeRates("dol")).toEqual([{ pair: "USDBRL", label: "Dólar americano" }]);
  });

  it("returns nothing for an unrelated query", () => {
    expect(matchExchangeRates("PETR4")).toEqual([]);
  });

  it("returns nothing for an empty or blank query", () => {
    expect(matchExchangeRates("")).toEqual([]);
    expect(matchExchangeRates("   ")).toEqual([]);
  });

  it("never matches BRL alone (both pairs share it, neither is keyed on it)", () => {
    expect(matchExchangeRates("brl")).toEqual([]);
  });
});

describe("exchangeRateHref", () => {
  it("builds the /cambio/<pair> route", () => {
    expect(exchangeRateHref("USDBRL")).toBe("/cambio/USDBRL");
    expect(exchangeRateHref("EURBRL")).toBe("/cambio/EURBRL");
  });
});
