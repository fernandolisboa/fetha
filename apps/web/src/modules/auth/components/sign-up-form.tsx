"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { initialActionState } from "../action-state";
import { signUpAction } from "../actions";
import { t } from "../strings";

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{t.signUp.nameLabel}</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t.signUp.emailLabel}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t.signUp.passwordLabel}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="termsAccepted" name="termsAccepted" />
        <Label htmlFor="termsAccepted">
          {t.signUp.termsLabel} (
          <Link href="/termos" className="underline underline-offset-4">
            {t.terms.title}
          </Link>
          )
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="privacyAccepted" name="privacyAccepted" />
        <Label htmlFor="privacyAccepted">
          {t.signUp.privacyLabel} (
          <Link href="/privacidade" className="underline underline-offset-4">
            {t.privacy.title}
          </Link>
          )
        </Label>
      </div>

      <Button type="submit" disabled={isPending}>
        {t.signUp.submit}
      </Button>

      <p className="text-muted-foreground text-sm">
        {t.signUp.alreadyHaveAccount}{" "}
        <Link href="/entrar" className="text-foreground underline underline-offset-4">
          {t.signUp.signInLink}
        </Link>
      </p>
    </form>
  );
}
