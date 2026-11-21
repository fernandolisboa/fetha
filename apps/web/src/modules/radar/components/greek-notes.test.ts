import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  tickerSchema,
  quantitySchema,
  type DecimalString,
} from "@fetha/contracts";
import type { Greeks, LegValuation } from "@fetha/engine";

import { GreekNotes } from "./greek-notes";

function dec(value: string): DecimalString {
  return decimalStringSchema.parse(value);
}

function greeks(overrides: Partial<Greeks> = {}): Greeks {
  return {
    delta: dec("3"),
    gamma: dec("-3"),
    theta: dec("0.09"),
    vega: dec("-0.11"),
    rho: dec("0"),
    ...overrides,
  };
}

function pricedLeg(overrides: Partial<LegValuation> = {}): LegValuation {
  return {
    leg: {
      role: "call",
      side: "buy",
      ticker: tickerSchema.parse("PETRK385"),
      quantity: quantitySchema.parse(100),
    },
    price: dec("1.20"),
    priceSource: "mid",
    stale: null,
    fairValue: dec("1.20"),
    impliedVolatility: dec("0.3"),
    volatilitySource: "own_implied",
    greeks: greeks(),
    timeToExpiryYears: dec("0.1"),
    notes: [],
    ...overrides,
  };
}

function render(props: { greeks: Greeks; legs?: LegValuation[] }): string {
  return renderToStaticMarkup(
    createElement(GreekNotes, { greeks: props.greeks, legs: props.legs ?? [pricedLeg()] }),
  );
}

describe("GreekNotes", () => {
  it("reads a positive theta as working for the viewer, with the signed amount", () => {
    const html = render({ greeks: greeks({ theta: dec("0.09") }) });
    expect(html).toContain("Joga a seu favor: +R$ 0,09 por pregão");
  });

  it("reads a negative theta as working against the viewer", () => {
    const html = render({ greeks: greeks({ theta: dec("-0.09") }) });
    expect(html).toContain("Joga contra: −R$ 0,09 por pregão");
  });

  it("reads a theta that rounds to zero centavos as neutral, not positive", () => {
    const html = render({ greeks: greeks({ theta: dec("0.001") }) });
    expect(html).toContain("Não faz diferença se o preço ficar parado.");
    expect(html).not.toContain("Joga a seu favor");
  });

  it("reads a positive vega as working for the viewer", () => {
    const html = render({ greeks: greeks({ vega: dec("0.11") }) });
    expect(html).toContain("Joga a seu favor: +R$ 0,11 para cada ponto");
  });

  it("reads a negative vega as working against the viewer", () => {
    const html = render({ greeks: greeks({ vega: dec("-0.11") }) });
    expect(html).toContain("Joga contra: −R$ 0,11 para cada ponto");
  });

  it("reads a vega that rounds to zero centavos as neutral", () => {
    const html = render({ greeks: greeks({ vega: dec("0.002") }) });
    expect(html).toContain("Não faz diferença se a volatilidade implícita mudar.");
  });

  it("reads a positive delta as shares bought", () => {
    const html = render({ greeks: greeks({ delta: dec("3") }) });
    expect(html).toContain("O lote se comporta como 3 ações compradas.");
  });

  it("reads a negative delta as shares sold", () => {
    const html = render({ greeks: greeks({ delta: dec("-3") }) });
    expect(html).toContain("O lote se comporta como 3 ações vendidas.");
  });

  it("shows one decimal place below ten shares of delta", () => {
    const html = render({ greeks: greeks({ delta: dec("0.4") }) });
    expect(html).toContain("O lote se comporta como 0,4 ações compradas.");
  });

  it("reads a delta that rounds to zero shares as neutral", () => {
    const html = render({ greeks: greeks({ delta: dec("0.02") }) });
    expect(html).toContain("O lote não se move com o preço.");
    expect(html).not.toContain("ações compradas");
  });

  it("reads a positive gamma as delta rising with the underlying", () => {
    const html = render({ greeks: greeks({ gamma: dec("3") }) });
    expect(html).toContain(
      "A cada R$ 1 de alta, o delta sobe cerca de 3 ações (e cai o mesmo na baixa).",
    );
  });

  it("reads a negative gamma as delta falling with the underlying", () => {
    const html = render({ greeks: greeks({ gamma: dec("-3") }) });
    expect(html).toContain(
      "A cada R$ 1 de alta, o delta cai cerca de 3 ações (e sobe o mesmo na baixa).",
    );
  });

  it("reads a gamma that rounds to zero shares as neutral", () => {
    const html = render({ greeks: greeks({ gamma: dec("0.02") }) });
    expect(html).toContain("O delta quase não muda quando o preço se move.");
  });

  it("replaces every greek sentence with one notice when a priced leg has no greeks", () => {
    const html = render({
      greeks: greeks(),
      legs: [pricedLeg(), pricedLeg({ price: dec("0.80"), greeks: null })],
    });
    expect(html).toContain("Gregas incompletas: uma perna ficou sem volatilidade calculada.");
    expect(html).not.toContain("Joga a seu favor");
    expect(html).not.toContain("ações compradas");
  });

  it("does not call greeks incomplete when an unpriced leg simply has no greeks", () => {
    const html = render({
      greeks: greeks(),
      legs: [pricedLeg(), pricedLeg({ price: null, greeks: null })],
    });
    expect(html).not.toContain("Gregas incompletas");
    expect(html).toContain("Joga a seu favor");
  });

  it("still shows the recipe's own calibration beside an incomplete-greeks notice", () => {
    const legs = [pricedLeg(), pricedLeg({ price: dec("0.80"), greeks: null })];
    const html = render({ greeks: greeks(), legs });
    const htmlWithCalibration = renderToStaticMarkup(
      createElement(GreekNotes, {
        greeks: greeks(),
        legs,
        calibration: {
          recipeId: "x",
          recipeName: "X",
          scored: 7,
          claimed: 7,
          held: 4,
          pnl: centavosSchema.parse(0),
        },
      }),
    );
    expect(html).not.toContain("Acertou");
    expect(htmlWithCalibration).toContain("Acertou 4 de 7 sugestões já vencidas.");
  });
});
