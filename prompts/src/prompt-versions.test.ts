import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { analysisSubjectKinds } from "@fetha/contracts";

import * as analysisV1 from "./analysis/v1";

// A released prompt's text never changes: editing it means adding a new
// version file and pointing `analysisPrompt` there (docs/adr/0057), so a
// stored request's version always names the text that was sent.
function digest(prompt: typeof analysisV1): string {
  const rendered = analysisSubjectKinds.map((subject) => prompt.render({ subject, facts: {} }));
  return createHash("sha256")
    .update([prompt.system, ...rendered].join("\n\u0000\n"))
    .digest("hex");
}

describe("released prompt versions", () => {
  it("analysis@1 is frozen", () => {
    expect(analysisV1.version).toBe("analysis@1");
    expect(digest(analysisV1)).toBe(
      "14ccb3932be07e2b3767cd2e605b7210ba02bef837da680f3219c173d2bbbe33",
    );
  });
});
