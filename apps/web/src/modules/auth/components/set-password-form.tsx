"use client";

import { useActionState } from "react";

import { ErrorNotice } from "@/components/error-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { initialActionState } from "../action-state";
import { setPasswordAction } from "../actions";
import { t } from "../strings";

export function SetPasswordForm() {
  const [state, formAction, isPending] = useActionState(setPasswordAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? <ErrorNotice>{state.message}</ErrorNotice> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">{t.setPassword.newPasswordLabel}</Label>
        <Input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {t.setPassword.submit}
      </Button>
    </form>
  );
}
