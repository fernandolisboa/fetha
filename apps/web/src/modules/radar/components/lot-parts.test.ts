import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { centavosSchema, decimalStringSchema } from "@fetha/contracts";

import { PayoffFigures } from "./lot-parts";

const decimal = (value: string) => decimalStringSchema.parse(value);

function render(props: Parameters<typeof PayoffFigures>[0]): string {
  return renderToStaticMarkup(createElement(PayoffFigures, props));
}

describe("PayoffFigures", () => {
  it("renders the fourth figure when given a probability of profit", () => {
    const html = render({
      maxLoss: centavosSchema.parse(7000),
      maxGain: centavosSchema.parse(13000),
      probabilityOfProfit: decimal("0.3588"),
    });
    expect(html).toContain("Chance de lucro");
    expect(html).toContain("36%");
    expect(html).toContain("Pelo modelo de preços, no vencimento. Não é previsão.");
  });

  it("renders nothing for the fourth figure when the probability is absent", () => {
    const html = render({
      maxLoss: centavosSchema.parse(7000),
      maxGain: centavosSchema.parse(13000),
    });
    expect(html).not.toContain("Chance de lucro");
  });

  it("renders nothing for the fourth figure when the probability is null", () => {
    const html = render({
      maxLoss: centavosSchema.parse(7000),
      maxGain: centavosSchema.parse(13000),
      probabilityOfProfit: null,
    });
    expect(html).not.toContain("Chance de lucro");
  });
});
