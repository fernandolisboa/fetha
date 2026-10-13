import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { analysisSubjectKinds } from "@fetha/contracts";

import * as analysisV1 from "./analysis/v1";
import * as analysisV2 from "./analysis/v2";
import { analysisPrompt } from "./index";

// A released prompt's text never changes: editing it means adding a new
// version file and pointing `analysisPrompt` there (docs/adr/0057), so a
// stored request's version always names the text that was sent.
function digest(prompt: typeof analysisV1 | typeof analysisV2): string {
  const rendered = analysisSubjectKinds.map((subject) => prompt.render({ subject, facts: {} }));
  return createHash("sha256")
    .update([prompt.system, ...rendered].join("\n\u0000\n"))
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

  it("new requests use analysis@2", () => {
    expect(analysisPrompt.version).toBe(analysisV2.version);
    expect(analysisPrompt.system).toBe(analysisV2.system);
  });
});
