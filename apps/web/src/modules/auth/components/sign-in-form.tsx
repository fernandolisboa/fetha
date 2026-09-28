"use client";

import Link from "next/link";
import { useActionState } from "react";

import { ErrorNotice } from "@/components/error-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { initialActionState } from "../action-state";
import { signInAction } from "../actions";
import { t } from "../strings";

export function SignInForm() {
  const [state, formAction, isPending] = useActionState(signInAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? <ErrorNotice>{state.message}</ErrorNotice> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t.signIn.emailLabel}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t.signIn.passwordLabel}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {t.signIn.submit}
      </Button>

      <p className="text-muted-foreground text-sm">
        <Link href="/redefinir-senha" className="text-foreground underline underline-offset-4">
          {t.signIn.forgotPasswordLink}
        </Link>
      </p>

      <p className="text-muted-foreground text-sm">
        <Link href="/link-magico" className="text-foreground underline underline-offset-4">
          {t.signIn.magicLinkLink}
        </Link>
      </p>

      <p className="text-muted-foreground text-sm">
        {t.signIn.noAccount}{" "}
        <Link href="/cadastro" className="text-foreground underline underline-offset-4">
          {t.signIn.signUpLink}
        </Link>
      </p>
    </form>
  );
}
