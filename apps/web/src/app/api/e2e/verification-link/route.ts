import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { mailOutbox } from "@/db/schema/mail-outbox";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth/env";

const URL_PATTERN = /https?:\/\/\S+/;

function extractLink(text: string): string | undefined {
  return URL_PATTERN.exec(text)?.[0];
}

export async function GET(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  if (request.headers.get("x-e2e-secret") !== configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const email = new URL(request.url).searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const [row] = await getDb()
    .select()
    .from(mailOutbox)
    .where(eq(mailOutbox.to, email))
    .orderBy(desc(mailOutbox.sentAt))
    .limit(1);

  if (!row) {
    return new NextResponse(null, { status: 404 });
  }

  const link = extractLink(row.text);
  if (!link) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json({ link });
}
