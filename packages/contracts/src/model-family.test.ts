import { describe, expect, it } from "vitest";

import {
  aiSettingsModelFamiliesSchema,
  analysisModelFamilyChoiceSchema,
  modelFamilySchema,
} from "./model-family";

describe("modelFamilySchema", () => {
  it.each(["haiku", "sonnet", "opus"])("accepts %s", (family) => {
    expect(modelFamilySchema.parse(family)).toBe(family);
  });

  it("rejects a family outside the closed list", () => {
    expect(modelFamilySchema.safeParse("fable").success).toBe(false);
  });
});

describe("analysisModelFamilyChoiceSchema", () => {
  it("accepts default plus every family", () => {
    for (const choice of ["default", "haiku", "sonnet", "opus"]) {
      expect(analysisModelFamilyChoiceSchema.parse(choice)).toBe(choice);
    }
  });

  it("rejects anything else", () => {
    expect(analysisModelFamilyChoiceSchema.safeParse("mythos").success).toBe(false);
  });
});

describe("aiSettingsModelFamiliesSchema", () => {
  it("accepts a partial record of kind to family", () => {
    expect(aiSettingsModelFamiliesSchema.parse({ signal: "haiku" })).toEqual({ signal: "haiku" });
    expect(aiSettingsModelFamiliesSchema.parse({})).toEqual({});
  });

  it("rejects an unknown kind", () => {
    expect(aiSettingsModelFamiliesSchema.safeParse({ nonsense: "haiku" }).success).toBe(false);
  });

  it("rejects a value outside the closed family list", () => {
    expect(aiSettingsModelFamiliesSchema.safeParse({ signal: "mythos" }).success).toBe(false);
  });
});
