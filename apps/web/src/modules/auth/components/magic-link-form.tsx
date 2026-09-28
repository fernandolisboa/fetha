"use client";

import Link from "next/link";
import { useActionState } from "react";

import { ErrorNotice } from "@/components/error-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { initialActionState } from "../action-state";
import { signInMagicLinkAction } from "../actions";
import { t } from "../strings";

export function MagicLinkForm() {
  const [state, formAction, isPending] = useActionState(signInMagicLinkAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? <ErrorNotice>{state.message}</ErrorNotice> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="magic-link-email">{t.magicLink.emailLabel}</Label>
        <Input id="magic-link-email" name="email" type="email" autoComplete="email" required />
      </div>

      <Button type="submit" disabled={isPending}>
        {t.magicLink.submit}
      </Button>

      <p className="text-muted-foreground text-sm">
        <Link href="/entrar" className="text-foreground underline underline-offset-4">
          {t.shared.signInWithPasswordLink}
        </Link>
      </p>
    </form>
  );
}
