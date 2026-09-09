"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { initialActionState } from "../action-state";
import { resendVerificationAction } from "../actions";
import { t } from "../strings";

export function ResendVerificationForm({ email }: { email: string }) {
  const [state, formAction, isPending] = useActionState(
    resendVerificationAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="email" value={email} />

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
