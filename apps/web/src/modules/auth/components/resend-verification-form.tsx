"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { initialActionState } from "../action-state";
import { resendVerificationAction } from "../actions";
import { t } from "../strings";

export function ResendVerificationForm({ email }: { email?: string }) {
  const [state, formAction, isPending] = useActionState(
    resendVerificationAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resend-email">{t.signIn.emailLabel}</Label>
        <Input
          id="resend-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={email}
          required
        />
      </div>

      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {state.status === "success" ? (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" variant="outline" disabled={isPending}>
        {t.verifyEmail.resend}
      </Button>
    </form>
  );
}
