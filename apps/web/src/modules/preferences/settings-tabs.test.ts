import { describe, expect, it } from "vitest";

import { settingsTabFromPathname, settingsTabHref, settingsTabs } from "./settings-tabs";

describe("settingsTabFromPathname", () => {
  it("round-trips every tab through its href", () => {
    for (const tab of settingsTabs) {
      expect(settingsTabFromPathname(settingsTabHref(tab))).toBe(tab);
    }
  });

  it("reads the tab from a nested path", () => {
    expect(settingsTabFromPathname("/configuracoes/conta/extra")).toBe("conta");
  });

  it("returns null outside a known tab", () => {
    expect(settingsTabFromPathname("/configuracoes")).toBeNull();
    expect(settingsTabFromPathname("/configuracoes/desconhecida")).toBeNull();
    expect(settingsTabFromPathname("/carteira/risco")).toBeNull();
    expect(settingsTabFromPathname("/configuracoesrisco")).toBeNull();
  });
});
