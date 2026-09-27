"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { initialActionState } from "../action-state";
import { acceptTermsAction } from "../actions";
import { t } from "../strings";

export function AcceptTermsForm({ showNameField }: { showNameField: boolean }) {
  const [state, formAction, isPending] = useActionState(acceptTermsAction, initialActionState);
  const labels = t.acceptTerms;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {showNameField ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">{labels.nameLabel}</Label>
          {/* Left empty on purpose: the name on file at this state is the
              unproven registrant's, not the mailbox owner's (docs/adr/0036). */}
          <Input id="name" name="name" autoComplete="name" required />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Checkbox id="termsAccepted" name="termsAccepted" />
        <Label htmlFor="termsAccepted">
          {labels.termsLabel} (
          <Link href="/termos" className="underline underline-offset-4">
            {t.terms.title}
          </Link>
          )
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="privacyAccepted" name="privacyAccepted" />
        <Label htmlFor="privacyAccepted">
          {labels.privacyLabel} (
          <Link href="/privacidade" className="underline underline-offset-4">
            {t.privacy.title}
          </Link>
          )
        </Label>
      </div>

      <Button type="submit" disabled={isPending}>
        {labels.submit}
      </Button>
    </form>
  );
}
