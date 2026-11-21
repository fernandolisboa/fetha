import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { centavosSchema, decimalStringSchema, type DecimalString } from "@fetha/contracts";
import type { Greeks, Note } from "@fetha/engine";

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

function render(props: { greeks: Greeks; notes?: Note[] }): string {
  return renderToStaticMarkup(
    createElement(GreekNotes, { greeks: props.greeks, notes: props.notes ?? [] }),
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
    expect(html).toContain("Não muda com o tamanho do movimento.");
  });

  it("replaces every greek sentence with one notice when a leg's volatility never converged", () => {
    const html = render({
      greeks: greeks(),
      notes: [{ code: "iv_not_converged", message: "x" }],
    });
    expect(html).toContain("Gregas incompletas: uma perna ficou sem volatilidade calculada.");
    expect(html).not.toContain("Joga a seu favor");
    expect(html).not.toContain("ações compradas");
  });

  it("still shows the recipe's own calibration beside an incomplete-greeks notice", () => {
    const html = render({
      greeks: greeks(),
      notes: [{ code: "iv_not_converged", message: "x" }],
    });
    const htmlWithCalibration = renderToStaticMarkup(
      createElement(GreekNotes, {
        greeks: greeks(),
        notes: [{ code: "iv_not_converged", message: "x" }],
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
