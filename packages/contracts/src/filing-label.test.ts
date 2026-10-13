import { describe, expect, it } from "vitest";

import {
  checkFilingLabel,
  filingLabelInputsSchema,
  summaryHoldsFigure,
  summaryHoldsLink,
} from "./filing-label";

const label = {
  topic: "dividends",
  tone: "positive",
  summary: "A companhia aprovou o pagamento de juros sobre capital próprio aos acionistas.",
};

describe("checkFilingLabel", () => {
  it("accepts words from the closed lists and a sentence with no figure", () => {
    expect(checkFilingLabel(label)).toEqual({ ok: true, label });
  });

  it.each([
    ["a topic outside the list", { ...label, topic: "weather" }],
    ["a numeric tone", { ...label, tone: 0.8 }],
    ["an extra field", { ...label, confidence: "high" }],
    ["an empty summary", { ...label, summary: "  " }],
    ["a summary longer than one sentence allows", { ...label, summary: "a".repeat(281) }],
    ["no reply at all", null],
  ])("rejects %s as schema", (_, reply) => {
    expect(checkFilingLabel(reply)).toEqual({ ok: false, problem: "schema" });
  });

  it.each([
    "Lucro de R$ 5 bilhões no trimestre.",
    "Dividendos de 2,5% ao ano.",
    "A dívida caiu pela metade.",
    "Pagamento de dois bilhões aos acionistas.",
    "Recompra de até cinco por cento das ações.",
    "Resultado de 2026 aprovado.",
    "Pagamento de quatrocentos reais por ação.",
  ])("rejects a summary holding a figure: %s", (summary) => {
    expect(checkFilingLabel({ ...label, summary })).toEqual({ ok: false, problem: "figure" });
  });
});

describe("summaryHoldsLink", () => {
  it.each([
    "Acesse www.exemplo.com.br para resgatar proventos.",
    "Detalhes em https://exemplo.org/proventos.",
    "Fale com ri@exemplo.com sobre o resgate.",
    "Veja o portal resgate.app hoje.",
  ])("finds a web address or handle: %s", (summary) => {
    expect(summaryHoldsLink(summary)).toBe(true);
    expect(checkFilingLabel({ ...label, summary })).toEqual({ ok: false, problem: "link" });
  });

  it("leaves a company name with a legal suffix alone", () => {
    expect(summaryHoldsLink("A Petrobras S.A. comunicou um acordo com a Vale.")).toBe(false);
  });
});

describe("summaryHoldsFigure", () => {
  it("leaves the indefinite article and words that merely contain a number word alone", () => {
    expect(
      summaryHoldsFigure("Uma nova diretora assume a área de milhas e dezenas de lojas."),
    ).toBe(false);
    expect(summaryHoldsFigure("A empresa comunicou um acordo setorial.")).toBe(false);
  });

  it("treats the exchange's name as a name, not a figure", () => {
    expect(summaryHoldsFigure("A holding respondeu a um ofício da B3.")).toBe(false);
    expect(summaryHoldsFigure("Ações da B3 e da B33 em pauta.")).toBe(true);
    expect(summaryHoldsFigure("Resultado do 3T26 divulgado à B3.")).toBe(true);
  });
});

describe("filingLabelInputsSchema", () => {
  it("accepts the CVM file's own columns", () => {
    expect(
      filingLabelInputsSchema.safeParse({
        companyName: "VALE S.A.",
        category: "material_fact",
        kind: null,
        subject: "Pagamento de dividendos",
        deliveredOn: "2026-10-08",
      }).success,
    ).toBe(true);
  });

  it("rejects a category the nightly job never stores", () => {
    expect(
      filingLabelInputsSchema.safeParse({
        companyName: "VALE S.A.",
        category: "board_meeting",
        kind: null,
        subject: "Ata",
        deliveredOn: "2026-10-08",
      }).success,
    ).toBe(false);
  });
});
