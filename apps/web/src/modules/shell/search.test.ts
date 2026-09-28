import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";

import {
  instrumentHref,
  mergeSearchOutcomes,
  optionSeriesHref,
  optionSeriesSummary,
  strategyHref,
  type OptionSeriesSearchHit,
} from "./search";

const series: OptionSeriesSearchHit = {
  ticker: "PETRJ400",
  underlying: "PETR4",
  right: "call",
  strike: "40" as DecimalString,
  expiry: "2026-10-16",
};

const throttled = { status: "error", error: "rate_limited" } as const;

describe("mergeSearchOutcomes", () => {
  it("merges three ok outcomes into one result set", () => {
    const merged = mergeSearchOutcomes({
      instruments: { status: "ok", results: [{ ticker: "PETR4" }] },
      optionSeries: { status: "ok", results: [series] },
      strategies: { status: "ok", results: [{ id: "s1", name: "Estratégia" }] },
    });
    expect(merged).toEqual({
      kind: "ok",
      instruments: [{ ticker: "PETR4" }],
      optionSeries: [series],
      strategies: [{ id: "s1", name: "Estratégia" }],
      throttled: false,
    });
  });

  it("keeps the other results and reports throttled when only the instrument search was throttled", () => {
    const merged = mergeSearchOutcomes({
      instruments: throttled,
      optionSeries: { status: "ok", results: [series] },
      strategies: { status: "ok", results: [{ id: "s1", name: "Estratégia" }] },
    });
    expect(merged).toEqual({
      kind: "ok",
      instruments: [],
      optionSeries: [series],
      strategies: [{ id: "s1", name: "Estratégia" }],
      throttled: true,
    });
  });

  it("keeps the other results and reports throttled when only the series search was throttled", () => {
    const merged = mergeSearchOutcomes({
      instruments: { status: "ok", results: [{ ticker: "PETR4" }] },
      optionSeries: throttled,
      strategies: { status: "ok", results: [] },
    });
    expect(merged).toEqual({
      kind: "ok",
      instruments: [{ ticker: "PETR4" }],
      optionSeries: [],
      strategies: [],
      throttled: true,
    });
  });

  it("keeps the other results and reports throttled when only the strategy search was throttled", () => {
    const merged = mergeSearchOutcomes({
      instruments: { status: "ok", results: [{ ticker: "PETR4" }] },
      optionSeries: { status: "ok", results: [] },
      strategies: throttled,
    });
    expect(merged).toEqual({
      kind: "ok",
      instruments: [{ ticker: "PETR4" }],
      optionSeries: [],
      strategies: [],
      throttled: true,
    });
  });

  it("stays ok when two of the three searches were throttled", () => {
    const merged = mergeSearchOutcomes({
      instruments: throttled,
      optionSeries: { status: "ok", results: [series] },
      strategies: throttled,
    });
    expect(merged).toEqual({
      kind: "ok",
      instruments: [],
      optionSeries: [series],
      strategies: [],
      throttled: true,
    });
  });

  it("is rate_limited when all three searches were throttled", () => {
    const merged = mergeSearchOutcomes({
      instruments: throttled,
      optionSeries: throttled,
      strategies: throttled,
    });
    expect(merged).toEqual({ kind: "rate_limited" });
  });
});

describe("instrumentHref", () => {
  it("builds the instrument page href", () => {
    expect(instrumentHref("PETR4")).toBe("/ativos/PETR4");
  });

  it("encodes characters unsafe in a URL segment", () => {
    expect(instrumentHref("PE R4")).toBe("/ativos/PE%20R4");
  });
});

describe("optionSeriesHref", () => {
  it("builds the option series page href", () => {
    expect(optionSeriesHref("PETRJ400")).toBe("/opcoes/PETRJ400");
  });

  it("encodes characters unsafe in a URL segment", () => {
    expect(optionSeriesHref("PE/RJ 400")).toBe("/opcoes/PE%2FRJ%20400");
  });
});

describe("strategyHref", () => {
  it("builds the strategy page href", () => {
    expect(strategyHref("abc-123")).toBe("/estrategias/abc-123");
  });

  it("encodes characters unsafe in a URL segment", () => {
    expect(strategyHref("id/with slash")).toBe("/estrategias/id%2Fwith%20slash");
  });
});

describe("optionSeriesSummary", () => {
  it("names the underlying, right, strike and expiry in pt-BR", () => {
    expect(optionSeriesSummary(series)).toBe("PETR4 · Call · R$ 40,00 · 16/10/2026");
  });

  it("labels a put and keeps the strike's centavos", () => {
    expect(optionSeriesSummary({ ...series, right: "put", strike: "38.47" as DecimalString })).toBe(
      "PETR4 · Put · R$ 38,47 · 16/10/2026",
    );
  });
});
