"use client";

import { startTransition, useState } from "react";
import type { Ticker } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { parseCentavosInput } from "@/lib/format/parse-money";

import { createBacktestRunAction } from "../actions";
import { costModelPresetIds, type CostModelPresetId } from "../default-config";
import { t } from "../strings";

export function CreateRunForm({
  strategyId,
  strategyVersionId,
  watchlistTickers,
}: {
  strategyId: string;
  strategyVersionId: string;
  watchlistTickers: Ticker[];
}) {
  const [universe, setUniverse] = useState<Ticker[]>(watchlistTickers.slice(0, 1));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [capital, setCapital] = useState("10.000,00");
  const [limits, setLimits] = useState<"enforce" | "warn">("warn");
  const [costModel, setCostModel] = useState<CostModelPresetId>("b3_default");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function toggleTicker(ticker: Ticker): void {
    setUniverse((current) =>
      current.includes(ticker)
        ? current.filter((candidate) => candidate !== ticker)
        : [...current, ticker],
    );
  }

  function submit(): void {
    setError(null);
    const capitalCentavos = parseCentavosInput(capital);
    if (universe.length === 0 || !from || !to || capitalCentavos === null) {
      setError(capitalCentavos === null ? t.create.invalidCapital : t.create.error);
      return;
    }
    setPending(true);
    startTransition(async () => {
      try {
        // createBacktestRunAction only ever returns on the error path: a
        // successful create redirects, which surfaces here as a thrown
        // NEXT_REDIRECT rather than a resolved value (see the catch below).
        const result = await createBacktestRunAction({
          strategyId,
          strategyVersionId,
          universe,
          from,
          to,
          initialCapital: capitalCentavos,
          limits,
          costModel,
        });
        if (result.error === "no_risk_profile") {
          setError(t.create.noRiskProfile);
        } else if (result.error === "unsatisfiable_collection") {
          setError(t.create.unsatisfiableCollection);
        } else {
          setError(t.create.error);
        }
        setPending(false);
      } catch (submitError) {
        if (submitError instanceof Error && submitError.message.includes("NEXT_REDIRECT")) {
          throw submitError;
        }
        setError(t.create.error);
        setPending(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>{t.create.universe}</Label>
        <p className="text-muted-foreground text-xs">{t.create.universeHint}</p>
        <div className="mt-2 flex flex-col gap-1">
          {watchlistTickers.map((ticker) => (
            <label key={ticker} className="flex items-center gap-2 font-mono text-sm">
              <Checkbox
                checked={universe.includes(ticker)}
                onCheckedChange={() => {
                  toggleTicker(ticker);
                }}
              />
              {ticker}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="backtest-from">{t.create.from}</Label>
          <Input
            id="backtest-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="backtest-to">{t.create.to}</Label>
          <Input
            id="backtest-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="backtest-capital">{t.create.capital}</Label>
        <Input
          id="backtest-capital"
          inputMode="decimal"
          value={capital}
          onChange={(event) => {
            setCapital(event.target.value);
          }}
        />
      </div>

      <div>
        <Label htmlFor="backtest-cost-model">{t.create.costModel}</Label>
        <Select
          value={costModel}
          onValueChange={(next) => {
            if (next && (costModelPresetIds as string[]).includes(next)) {
              setCostModel(next);
            }
          }}
        >
          <SelectTrigger id="backtest-cost-model" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {costModelPresetIds.map((presetId) => (
              <SelectItem key={presetId} value={presetId}>
                {t.create.costModelPresets[presetId]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="backtest-limits">{t.create.limits}</Label>
        <Select
          value={limits}
          onValueChange={(next) => {
            if (next === "enforce" || next === "warn") {
              setLimits(next);
            }
          }}
        >
          <SelectTrigger id="backtest-limits" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="warn">{t.create.limitsWarn}</SelectItem>
            <SelectItem value="enforce">{t.create.limitsEnforce}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      <Button onClick={submit} disabled={pending}>
        {t.create.submit}
      </Button>
    </div>
  );
}
