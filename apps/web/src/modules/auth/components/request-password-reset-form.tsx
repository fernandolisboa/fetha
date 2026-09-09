"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { initialActionState } from "../action-state";
import { requestPasswordResetAction } from "../actions";
import { t } from "../strings";

export function RequestPasswordResetForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-request-email">{t.passwordReset.emailLabel}</Label>
        <Input id="reset-request-email" name="email" type="email" autoComplete="email" required />
      </div>

      <Button type="submit" disabled={isPending}>
        {t.passwordReset.requestSubmit}
      </Button>

      <p className="text-muted-foreground text-sm">
        <Link href="/entrar" className="text-foreground underline underline-offset-4">
          {t.magicLink.signInWithPasswordLink}
        </Link>
      </p>
    </form>
  );
}
