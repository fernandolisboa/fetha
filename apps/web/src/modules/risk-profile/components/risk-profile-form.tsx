"use client";

import { startTransition, useState } from "react";
import { centavosSchema, type RiskProfile } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, parseBRLToCentavos } from "@/lib/format/brl";
import { formatPercent, parsePercentToFraction } from "@/lib/format/percent";

import { declareRiskProfileAction } from "../actions";
import { t } from "../strings";

const DEFAULT_DECLARED_CAPITAL_PLACEHOLDER = formatBRL(centavosSchema.parse(5000000));

function centsToInputValue(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

function percentToInputValue(fraction: RiskProfile["limits"]["maxLossPerOperation"]): string {
  return formatPercent(fraction).replace("%", "");
}

export function RiskProfileForm({ current }: { current: RiskProfile | null }) {
  const [declaredCapital, setDeclaredCapital] = useState(
    current ? centsToInputValue(current.declaredCapital) : "",
  );
  const [maxLossPerOperation, setMaxLossPerOperation] = useState(
    current ? percentToInputValue(current.limits.maxLossPerOperation) : "2",
  );
  const [maxExposurePerOperation, setMaxExposurePerOperation] = useState(
    current ? percentToInputValue(current.limits.maxExposurePerOperation) : "10",
  );
  const [maxOpenOperations, setMaxOpenOperations] = useState(
    current ? String(current.limits.maxOpenOperations) : "5",
  );
  const [maxPremiumBought, setMaxPremiumBought] = useState(
    current ? percentToInputValue(current.limits.maxPremiumBought) : "5",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function submit() {
    const capital = parseBRLToCentavos(declaredCapital);
    const maxLoss = parsePercentToFraction(maxLossPerOperation);
    const maxExposure = parsePercentToFraction(maxExposurePerOperation);
    const maxOpen = Number.parseInt(maxOpenOperations, 10);
    const maxPremium = parsePercentToFraction(maxPremiumBought);

    if (
      capital === null ||
      maxLoss === null ||
      maxExposure === null ||
      maxPremium === null ||
      !Number.isInteger(maxOpen) ||
      maxOpen < 1
    ) {
      setError(t.form.errors.invalid);
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
            setError(t.form.errors.invalid);
          }
        })
        .catch(() => {
          setPending(false);
          setError(t.form.errors.invalid);
        });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="declared-capital">{t.form.declaredCapital}</Label>
        <Input
          id="declared-capital"
          inputMode="decimal"
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
          <Label htmlFor="max-loss">{t.form.maxLossPerOperation}</Label>
          <Input
            id="max-loss"
            inputMode="decimal"
            value={maxLossPerOperation}
            onChange={(event) => {
              setMaxLossPerOperation(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-exposure">{t.form.maxExposurePerOperation}</Label>
          <Input
            id="max-exposure"
            inputMode="decimal"
            value={maxExposurePerOperation}
            onChange={(event) => {
              setMaxExposurePerOperation(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-open-operations">{t.form.maxOpenOperations}</Label>
          <Input
            id="max-open-operations"
            inputMode="numeric"
            value={maxOpenOperations}
            onChange={(event) => {
              setMaxOpenOperations(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-premium-bought">{t.form.maxPremiumBought}</Label>
          <Input
            id="max-premium-bought"
            inputMode="decimal"
            value={maxPremiumBought}
            onChange={(event) => {
              setMaxPremiumBought(event.target.value);
              setSaved(false);
            }}
          />
        </div>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {saved && !error ? <p className="text-muted-foreground text-xs">{t.form.saved}</p> : null}

      <Button type="button" onClick={submit} disabled={pending} className="self-start">
        {t.form.submit}
      </Button>
    </div>
  );
}
