import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { analysisObjectKinds, analysisSubjectKinds } from "@fetha/contracts";

import * as analysisV1 from "./analysis/v1";
import * as analysisV2 from "./analysis/v2";
import * as analysisV3 from "./analysis/v3";
import * as filingLabelV1 from "./filing-label/v1";
import * as researchV1 from "./research/v1";
import { analysisPrompt, filingLabelPrompt, researchPrompt } from "./index";

const releasedBeforeSuggestions = analysisSubjectKinds.filter(
  (subject): subject is analysisV2.ReleasedSubject =>
    subject !== "suggestion" && subject !== "research",
);

// A released prompt's text never changes: editing it means adding a new
// version file and pointing `analysisPrompt` there (docs/adr/0057), so a
// stored request's version always names the text that was sent.
function digest(prompt: typeof analysisV1 | typeof analysisV2): string {
  const rendered = releasedBeforeSuggestions.map((subject) =>
    prompt.render({ subject, facts: {} }),
  );
  return createHash("sha256")
    .update([prompt.system, ...rendered].join("\n\u0000\n"))
    .digest("hex");
}

function digestV3(): string {
  const rendered = analysisObjectKinds.map((subject) => analysisV3.render({ subject, facts: {} }));
  return createHash("sha256")
    .update([analysisV3.system, ...rendered].join("\n\u0000\n"))
    .digest("hex");
}

describe("released prompt versions", () => {
  it("analysis@1 is frozen", () => {
    expect(analysisV1.version).toBe("analysis@1");
    expect(digest(analysisV1)).toBe(
      "6518299b80d13f98631833c0a24d3553bb56ba3319ffe0979905ad78b5289813",
    );
  });

  it("analysis@2 is frozen", () => {
    expect(analysisV2.version).toBe("analysis@2");
    expect(digest(analysisV2)).toBe(
      "4565ff49d9c4601dbb69a7d178f8f425bbedcd1057d7756d2bf4ac0eca315250",
    );
  });

  it("analysis@3 is frozen", () => {
    expect(analysisV3.version).toBe("analysis@3");
    expect(digestV3()).toBe("c1b27e3fc9b49709c63d3c8297f46df2e69d6b61098f20a941befb8bc3748234");
  });

  it("new requests use analysis@3", () => {
    expect(analysisPrompt.version).toBe(analysisV3.version);
    expect(analysisPrompt.system).toBe(analysisV3.system);
  });

  it("research@1 is frozen", () => {
    expect(researchV1.version).toBe("research@1");
    expect(
      createHash("sha256")
        .update(
          [researchV1.system, researchV1.render({ subject: "research", facts: {} })].join(
            "\n\u0000\n",
          ),
        )
        .digest("hex"),
    ).toBe("5db5db63918fcc54b4763450cd63925d1c9ce1259842a23ad79e7d6df1447932");
  });

  it("new researches use research@1", () => {
    expect(researchPrompt.version).toBe(researchV1.version);
    expect(researchPrompt.system).toBe(researchV1.system);
  });

  it("filing-label@1 is frozen", () => {
    expect(filingLabelV1.version).toBe("filing-label@1");
    const rendered = filingLabelV1.render({
      companyName: "EXEMPLO S.A.",
      category: "material_fact",
      kind: null,
      subject: "Assunto",
      deliveredOn: "2026-10-13",
    });
    expect(
      createHash("sha256")
        .update([filingLabelV1.system, rendered].join("\n\u0000\n"))
        .digest("hex"),
    ).toBe("6c0f3f65e8b4e611b120e865c5e508d57fed05b63304ebe9e240ceca9ac98806");
  });

  it("new filing labels use filing-label@1", () => {
    expect(filingLabelPrompt.version).toBe(filingLabelV1.version);
  });
});
