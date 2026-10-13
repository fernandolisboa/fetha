import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssetNextSteps } from "./asset-next-steps";

function render(props: Parameters<typeof AssetNextSteps>[0]): string {
  return renderToStaticMarkup(createElement(AssetNextSteps, props));
}

describe("AssetNextSteps", () => {
  it("offers the recipe step and the strategy sentence for an ordinary instrument", () => {
    const html = render({ ticker: "PETR4", onWatchlist: true, hasActiveStrategy: false });
    expect(html).toContain("#receitas");
    expect(html).toContain("/estrategias");
  });

  it("ADR-0062: drops the recipe step and the strategy sentence for a market index", () => {
    const html = render({
      ticker: "IBOV11",
      onWatchlist: true,
      hasActiveStrategy: false,
      isIndex: true,
    });
    expect(html).not.toContain("#receitas");
    expect(html).not.toContain("/estrategias");
  });
});
