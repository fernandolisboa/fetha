import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth/env";
import { findLatestVerificationLink } from "@/modules/auth/verification-link";

function timingSafeEqualStrings(provided: string, configured: string): boolean {
  if (provided.length !== configured.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided), Buffer.from(configured));
}

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

  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json({ link });
}
