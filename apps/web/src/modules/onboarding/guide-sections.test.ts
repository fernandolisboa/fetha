import { describe, expect, it } from "vitest";

import { destinations } from "@/modules/shell/client";

import { guideSections } from "./guide-sections";
import { onboardingStrings } from "./strings";

describe("guideSections", () => {
  it("follows the rail's destinations in order", () => {
    expect(guideSections().map((section) => section.href)).toEqual(
      destinations().map((destination) => destination.href),
    );
  });

  it("explains every destination with a summary and at least one step", () => {
    for (const section of guideSections()) {
      expect(section.summary).not.toBe("");
      expect(section.steps.length).toBeGreaterThan(0);
    }
  });

  it("ships the same number of steps in pt-BR as in the English source", () => {
    const { en, ptBR } = onboardingStrings;
    for (const href of Object.keys(
      en.guide.destinations,
    ) as (keyof typeof en.guide.destinations)[]) {
      expect(ptBR.guide.destinations[href].steps).toHaveLength(
        en.guide.destinations[href].steps.length,
      );
    }
    expect(ptBR.guide.flow.steps).toHaveLength(en.guide.flow.steps.length);
    expect(ptBR.guide.header.steps).toHaveLength(en.guide.header.steps.length);
    expect(ptBR.guide.principles.steps).toHaveLength(en.guide.principles.steps.length);
  });
});
