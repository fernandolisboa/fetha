"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import type { Ticker } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";

import { startRecipeAction, type StartRecipeResult } from "../actions";
import { DEFAULT_RECIPE_RISK_FRACTION } from "../risk";
import { t } from "../strings";

function isRedirect(error: unknown): boolean {
  return error instanceof Error && error.message.includes("NEXT_REDIRECT");
}

// The recipe start flow (docs/adr/0064) from a suggestion's page (docs/adr/0067), at the
// recipes' default risk: a successful start redirects to the report.
export function RecipeTestButton({ recipeId, ticker }: { recipeId: string; ticker: Ticker }) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<StartRecipeResult | null>(null);

  function start(): void {
    setFailure(null);
    setPending(true);
    startTransition(async () => {
      try {
        setFailure(
          await startRecipeAction({ recipeId, ticker, riskFraction: DEFAULT_RECIPE_RISK_FRACTION }),
        );
      } catch (error) {
        if (isRedirect(error)) throw error;
        setFailure({ status: "error", error: "invalid" });
      }
      setPending(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" className="self-start" disabled={pending} onClick={start}>
        {pending ? t.test.starting : t.test.start(ticker)}
      </Button>
      {failure ? (
        <ErrorNotice>
          {t.errors[failure.error].replace("{ticker}", ticker)}
          {failure.error === "no_risk_profile" ? (
            <>
              {" "}
              <Link href="/configuracoes" className="underline-offset-4 hover:underline">
                {t.picker.noRiskProfileLink}
              </Link>
            </>
          ) : null}
          {failure.strategyId ? (
            <>
              {" "}
              <Link
                href={`/estrategias/${failure.strategyId}`}
                className="underline-offset-4 hover:underline"
              >
                {t.errors.strategyLink}
              </Link>
            </>
          ) : null}
        </ErrorNotice>
      ) : null}
    </div>
  );
}
