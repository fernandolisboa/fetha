import { describe, expect, it } from "vitest";
import { deriveSearchMessage, deriveSearchStatusText } from "./search-status";

const messages = {
  searching: "Buscando…",
  rateLimited: "Muitas buscas seguidas. Espere alguns segundos e tente de novo.",
  searchError: "Não foi possível buscar ativos. Tente novamente.",
  empty: "Nenhum ativo encontrado.",
};

describe("deriveSearchMessage", () => {
  it("returns the searching copy while pending", () => {
    expect(
      deriveSearchMessage({ pending: true, rateLimited: false, searchFailed: false }, messages),
    ).toBe(messages.searching);
  });

  it("returns the rate-limited copy when the search was throttled", () => {
    expect(
      deriveSearchMessage({ pending: false, rateLimited: true, searchFailed: false }, messages),
    ).toBe(messages.rateLimited);
  });

  it("returns the search-error copy when the search failed", () => {
    expect(
      deriveSearchMessage({ pending: false, rateLimited: false, searchFailed: true }, messages),
    ).toBe(messages.searchError);
  });

  it("returns the empty copy otherwise", () => {
    expect(
      deriveSearchMessage({ pending: false, rateLimited: false, searchFailed: false }, messages),
    ).toBe(messages.empty);
  });

  it("prioritizes pending over rate-limited and failed", () => {
    expect(
      deriveSearchMessage({ pending: true, rateLimited: true, searchFailed: true }, messages),
    ).toBe(messages.searching);
  });
});

describe("deriveSearchStatusText", () => {
  it("stays silent when the query is empty", () => {
    expect(
      deriveSearchStatusText(messages.empty, { trimmedQueryLength: 0, hasResults: false }),
    ).toBe("");
  });

  it("stays silent when there are results, even with a message computed", () => {
    expect(
      deriveSearchStatusText(messages.empty, { trimmedQueryLength: 5, hasResults: true }),
    ).toBe("");
  });

  it("announces the message once a query has no results", () => {
    expect(
      deriveSearchStatusText(messages.empty, { trimmedQueryLength: 5, hasResults: false }),
    ).toBe(messages.empty);
  });

  it("announces the searching message while pending", () => {
    expect(
      deriveSearchStatusText(messages.searching, { trimmedQueryLength: 5, hasResults: false }),
    ).toBe(messages.searching);
  });

  it("announces the rate-limited message", () => {
    expect(
      deriveSearchStatusText(messages.rateLimited, { trimmedQueryLength: 5, hasResults: false }),
    ).toBe(messages.rateLimited);
  });

  it("announces the search-error message", () => {
    expect(
      deriveSearchStatusText(messages.searchError, { trimmedQueryLength: 5, hasResults: false }),
    ).toBe(messages.searchError);
  });
});
