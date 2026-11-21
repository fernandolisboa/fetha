import { NextResponse } from "next/server";

import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import { getLessonQuizAnswersForE2E } from "@/modules/learning";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

// E2E-only, same guard as `/api/e2e/verification-link`: `learning.spec.ts`
// needs the lesson's correct answers to drive the quiz form through the UI
// without hardcoding them in the spec, where a content edit would silently
// break the test. The catalog is shared reference data (ADR-0012), not
// user-scoped, so this reads no one's data.
export function GET(request: Request): Response {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  const lessonId = new URL(request.url).searchParams.get("lesson") ?? "";
  const answers = getLessonQuizAnswersForE2E(lessonId);
  if (!answers) {
    return NextResponse.json({ error: "unknown lesson" }, { status: 404 });
  }

  return NextResponse.json({ answers });
}
