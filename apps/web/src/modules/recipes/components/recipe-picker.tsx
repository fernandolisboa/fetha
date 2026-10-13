"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import { expectedMoves, type ExpectedMove, type Ticker } from "@fetha/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ErrorNotice } from "@/components/error-notice";

import { startRecipeAction, type StartRecipeResult } from "../actions";
import type { RecipeCard, RiskOption } from "../cards";
import {
  DEFAULT_RECIPE_RISK_FRACTION,
  recipeRiskFractions,
  type RecipeRiskFraction,
} from "../risk";
import { t } from "../strings";
import { PayoffSketchSvg } from "./payoff-sketch-svg";

function isRedirect(error: unknown): boolean {
  return error instanceof Error && error.message.includes("NEXT_REDIRECT");
}

export function RecipePicker({
  ticker,
  cards,
  riskOptions,
}: {
  ticker: Ticker;
  cards: RecipeCard[];
  riskOptions: RiskOption[] | null;
}) {
  const [move, setMove] = useState<ExpectedMove | null>(null);
  const [risk, setRisk] = useState<RecipeRiskFraction>(DEFAULT_RECIPE_RISK_FRACTION);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<StartRecipeResult | null>(null);

  const visible = move ? cards.filter((card) => card.expectedMove === move) : [];

  function start(recipeId: string): void {
    setFailure(null);
    setPendingId(recipeId);
    startTransition(async () => {
      try {
        // A successful start redirects to the report, which surfaces here as
        // a thrown NEXT_REDIRECT; only the error path resolves.
        setFailure(await startRecipeAction({ recipeId, ticker, riskFraction: risk }));
      } catch (error) {
        if (isRedirect(error)) throw error;
        setFailure({ status: "error", error: "invalid" });
      }
      setPendingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium">
          {t.picker.moveQuestion.replace("{ticker}", ticker)}
        </legend>
        <RadioGroup
          value={move}
          onValueChange={(value) => {
            const next = expectedMoves.find((candidate) => candidate === value);
            if (next) {
              setMove(next);
              setFailure(null);
            }
          }}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {expectedMoves.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={value} />
              {t.picker.moves[value]}
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      {riskOptions ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium">{t.picker.riskQuestion}</legend>
          <RadioGroup
            value={risk}
            onValueChange={(value) => {
              const next = recipeRiskFractions.find((candidate) => candidate === value);
              if (next) setRisk(next);
            }}
            className="flex flex-col gap-2"
          >
            {riskOptions.map((option) => (
              <label key={option.fraction} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={option.fraction} />
                <span>{option.label}</span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {option.amount}
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t.picker.noRiskProfile}{" "}
          <Link href="/configuracoes" className="text-primary underline-offset-4 hover:underline">
            {t.picker.noRiskProfileLink}
          </Link>
        </p>
      )}

      {move === null ? (
        <p className="text-muted-foreground text-sm">{t.picker.pickMove}</p>
      ) : (
        <section aria-label={t.picker.listTitle} className="flex flex-col gap-2">
          <ul className="border-border divide-border flex flex-col divide-y border-y">
            {visible.map((card) => (
              <li
                key={card.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <PayoffSketchSvg points={card.sketch} label={t.picker.sketchLabel} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{card.name}</h3>
                      <Badge variant="outline">{t.picker.ivRegimes[card.ivRegime]}</Badge>
                    </div>
                    <p className="text-sm text-pretty">{card.summary}</p>
                    <p className="text-muted-foreground text-xs">{card.maxLoss}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={riskOptions === null || pendingId !== null}
                  onClick={() => {
                    start(card.id);
                  }}
                  aria-label={`${t.picker.start}: ${card.name}`}
                >
                  {pendingId === card.id ? t.picker.starting : t.picker.start}
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs text-pretty">
            {t.picker.footnote.replace("{ticker}", ticker)}
          </p>
        </section>
      )}

      {failure ? (
        <ErrorNotice>
          {t.errors[failure.error].replace("{ticker}", ticker)}
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
