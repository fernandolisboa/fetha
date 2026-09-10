"use client";

import { startTransition, useState } from "react";
import { Decimal } from "decimal.js";
import { centavosSchema, type RiskProfile } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, parseBRLToCentavos } from "@/lib/format/brl";
import { fractionToPercentInputValue, parsePercentToFraction } from "@/lib/format/percent";

import { declareRiskProfileAction } from "../risk-profile-actions";
import { t } from "../strings";

const DEFAULT_DECLARED_CAPITAL_PLACEHOLDER = formatBRL(centavosSchema.parse(5000000));
const MAX_OPEN_OPERATIONS_PATTERN = /^\d+$/;

// Display only; the stored value is always an integer number of centavos
// (ADR-0001: money never as a JS `number` in arithmetic). Decimal keeps the
// division exact instead of a raw floating-point `centavos / 100`.
function centsToInputValue(centavos: number): string {
  return new Decimal(centavos).dividedBy(100).toFixed(2).replace(".", ",");
}

export function RiskProfileForm({ current }: { current: RiskProfile | null }) {
  const [declaredCapital, setDeclaredCapital] = useState(
    current ? centsToInputValue(current.declaredCapital) : "",
  );
  const [maxLossPerOperation, setMaxLossPerOperation] = useState(
    current ? fractionToPercentInputValue(current.limits.maxLossPerOperation) : "2",
  );
  const [maxExposurePerOperation, setMaxExposurePerOperation] = useState(
    current ? fractionToPercentInputValue(current.limits.maxExposurePerOperation) : "10",
  );
  const [maxOpenOperations, setMaxOpenOperations] = useState(
    current ? String(current.limits.maxOpenOperations) : "5",
  );
  const [maxPremiumBought, setMaxPremiumBought] = useState(
    current ? fractionToPercentInputValue(current.limits.maxPremiumBought) : "5",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function submit() {
    const capital = parseBRLToCentavos(declaredCapital);
    const maxLoss = parsePercentToFraction(maxLossPerOperation);
    const maxExposure = parsePercentToFraction(maxExposurePerOperation);
    const maxOpenIsWellFormed = MAX_OPEN_OPERATIONS_PATTERN.test(maxOpenOperations.trim());
    const maxOpen = maxOpenIsWellFormed ? Number.parseInt(maxOpenOperations, 10) : NaN;
    const maxPremium = parsePercentToFraction(maxPremiumBought);

    if (
      capital === null ||
      maxLoss === null ||
      maxExposure === null ||
      maxPremium === null ||
      !maxOpenIsWellFormed ||
      !Number.isInteger(maxOpen) ||
      maxOpen < 1
    ) {
      setError(t.riskProfileForm.errors.invalid);
      setSaved(false);
      return;
    }

    setError(null);
    setPending(true);
    startTransition(() => {
      declareRiskProfileAction({
        declaredCapital: capital,
        limits: {
          maxLossPerOperation: maxLoss,
          maxExposurePerOperation: maxExposure,
          maxOpenOperations: maxOpen,
          maxPremiumBought: maxPremium,
        },
      })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            setSaved(true);
          } else {
            setError(t.riskProfileForm.errors.invalid);
          }
        })
        .catch(() => {
          setPending(false);
          setError(t.riskProfileForm.errors.invalid);
        });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="declared-capital">{t.riskProfileForm.declaredCapital}</Label>
        <Input
          id="declared-capital"
          inputMode="decimal"
          className="text-right font-mono tabular-nums"
          value={declaredCapital}
          onChange={(event) => {
            setDeclaredCapital(event.target.value);
            setSaved(false);
          }}
          placeholder={DEFAULT_DECLARED_CAPITAL_PLACEHOLDER}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-loss">{t.riskProfileForm.maxLossPerOperation}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="max-loss"
              inputMode="decimal"
              className="text-right font-mono tabular-nums"
              value={maxLossPerOperation}
              onChange={(event) => {
                setMaxLossPerOperation(event.target.value);
                setSaved(false);
              }}
            />
            <span className="text-muted-foreground shrink-0 text-xs">
              {t.riskProfileForm.asPercentOfCapital}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-exposure">{t.riskProfileForm.maxExposurePerOperation}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="max-exposure"
              inputMode="decimal"
              className="text-right font-mono tabular-nums"
              value={maxExposurePerOperation}
              onChange={(event) => {
                setMaxExposurePerOperation(event.target.value);
                setSaved(false);
              }}
            />
            <span className="text-muted-foreground shrink-0 text-xs">
              {t.riskProfileForm.asPercentOfCapital}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-open-operations">{t.riskProfileForm.maxOpenOperations}</Label>
          <Input
            id="max-open-operations"
            inputMode="numeric"
            className="text-right font-mono tabular-nums"
            value={maxOpenOperations}
            onChange={(event) => {
              setMaxOpenOperations(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-premium-bought">{t.riskProfileForm.maxPremiumBought}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="max-premium-bought"
              inputMode="decimal"
              className="text-right font-mono tabular-nums"
              value={maxPremiumBought}
              onChange={(event) => {
                setMaxPremiumBought(event.target.value);
                setSaved(false);
              }}
            />
            <span className="text-muted-foreground shrink-0 text-xs">
              {t.riskProfileForm.asPercentOfCapital}
            </span>
          </div>
        </div>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {saved && !error ? (
        <p className="text-muted-foreground text-xs">{t.riskProfileForm.saved}</p>
      ) : null}

      <Button type="button" onClick={submit} disabled={pending} className="self-start">
        {t.riskProfileForm.submit}
      </Button>
    </div>
  );
}
