import { NextResponse } from "next/server";

import { isProductionDeployment, readE2ESecret, readE2EVerificationLink } from "@/modules/auth";

import { timingSafeEqualStrings } from "./timing-safe-equal-strings";

export async function GET(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  const email = new URL(request.url).searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const link = await readE2EVerificationLink(email);
  if (!link) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json({ link });
}
