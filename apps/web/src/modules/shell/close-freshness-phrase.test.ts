import { describe, expect, it } from "vitest";

import { closeFreshnessPhrase } from "./close-freshness-phrase";

describe("closeFreshnessPhrase", () => {
  it("renders today's close in pt-BR", () => {
    expect(closeFreshnessPhrase({ kind: "today" })).toBe("fechamento de hoje");
  });

  it("renders yesterday's close in pt-BR", () => {
    expect(closeFreshnessPhrase({ kind: "yesterday" })).toBe("fechamento de ontem");
  });

  it("renders an older session's date in pt-BR", () => {
    expect(closeFreshnessPhrase({ kind: "older", session: "2026-10-10" })).toBe(
      "fechamento de 10/10/2026",
    );
  });
});
