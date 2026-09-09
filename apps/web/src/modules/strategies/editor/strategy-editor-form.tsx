"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  strategyDefinitionSchema,
  timeframes,
  type AdjustmentRule,
  type DecimalString,
  type ExitRule,
  type ExpirySelection,
  type SizingRule,
  type StrikeSelection,
  type Structure,
  type StrategyDefinition,
} from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { addStrategyVersionAction, createStrategyAction } from "../actions";
import { t } from "../strings";
import { AdjustmentRow } from "./adjustment-row";
import {
  compareConditionsToEntry,
  entryToCompareConditions,
  type CompareCondition,
} from "./compare-conditions";
import { ConditionRow } from "./condition-row";
import { defaultCompareCondition } from "./defaults";
import { ExpiryFields } from "./expiry-fields";
import { ExitRuleRow } from "./exit-rule-row";
import { SimpleSelect } from "./simple-select";
import { SizingFields } from "./sizing-fields";
import { StrikeList } from "./strike-list";

const defaultExpiry: ExpirySelection = { kind: "business_days", min: 5, max: 20 };

export function StrategyEditorForm({
  structures,
  initial,
  strategyId,
}: {
  structures: Structure[];
  initial?: StrategyDefinition;
  strategyId?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [timeframe, setTimeframe] = useState(initial?.timeframe ?? "D1");
  const [structureId, setStructureId] = useState(initial?.structureId ?? structures[0]?.id ?? "");
  const [conditions, setConditions] = useState<CompareCondition[]>(
    initial
      ? entryToCompareConditions(initial.entry, defaultCompareCondition)
      : [defaultCompareCondition],
  );
  const [strikes, setStrikes] = useState<StrikeSelection[]>(initial?.strikes ?? []);
  const [expiry, setExpiry] = useState<ExpirySelection>(initial?.expiry ?? defaultExpiry);
  const [sizing, setSizing] = useState<SizingRule>(
    initial?.sizing ?? { kind: "fixed_fractional", fraction: "0.1" as DecimalString },
  );
  const [exit, setExit] = useState<ExitRule[]>(initial?.exit ?? []);
  const [adjustments, setAdjustments] = useState<AdjustmentRule[]>(initial?.adjustments ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function buildDefinition(): StrategyDefinition {
    return {
      name,
      timeframe,
      entry: compareConditionsToEntry(conditions),
      structureId,
      strikes,
      expiry: strikes.length > 0 ? expiry : undefined,
      sizing,
      exit,
      adjustments,
    };
  }

  function submit() {
    const definition = buildDefinition();
    const parsed = strategyDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      setError(t.editor.invalid);
      return;
    }
    setError(null);
    setPending(true);
    startTransition(() => {
      const action = strategyId
        ? addStrategyVersionAction({ strategyId, definition: parsed.data })
        : createStrategyAction({ name: parsed.data.name, definition: parsed.data });
      action
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            router.push(`/estrategias/${result.strategyId}`);
          } else {
            setError(t.editor.invalid);
          }
        })
        .catch(() => {
          setPending(false);
          setError(t.editor.invalid);
        });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="strategy-name">{t.editor.name.label}</Label>
          <Input
            id="strategy-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <div className="flex w-36 flex-col gap-1.5">
          <Label>{t.editor.timeframe.label}</Label>
          <SimpleSelect
            ariaLabel={t.editor.timeframe.label}
            value={timeframe}
            onValueChange={(value) => {
              setTimeframe(value as StrategyDefinition["timeframe"]);
            }}
            options={timeframes.map((value) => ({ value, label: value }))}
          />
        </div>
        <div className="flex w-64 flex-col gap-1.5">
          <Label>{t.editor.structure.label}</Label>
          <SimpleSelect
            ariaLabel={t.editor.structure.label}
            value={structureId}
            onValueChange={setStructureId}
            options={structures.map((structure) => ({
              value: structure.id,
              label: structure.name,
            }))}
          />
        </div>
      </div>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{t.editor.entry.title}</h2>
          <p className="text-muted-foreground text-xs">{t.editor.entry.subtitle}</p>
        </div>
        {conditions.map((condition, index) => (
          <ConditionRow
            key={index}
            value={condition}
            removable={conditions.length > 1}
            onChange={(next) => {
              setConditions(conditions.map((c, i) => (i === index ? next : c)));
            }}
            onRemove={() => {
              setConditions(conditions.filter((_, i) => i !== index));
            }}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setConditions([...conditions, defaultCompareCondition]);
          }}
        >
          {t.editor.entry.addCondition}
        </Button>
      </section>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{t.editor.strikes.title}</h2>
          <p className="text-muted-foreground text-xs">{t.editor.strikes.subtitle}</p>
        </div>
        <StrikeList strikes={strikes} onChange={setStrikes} />
        {strikes.length > 0 && (
          <div>
            <h3 className="text-sm font-medium">{t.editor.expiry.title}</h3>
            <ExpiryFields value={expiry} onChange={setExpiry} />
          </div>
        )}
      </section>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <h2 className="text-sm font-medium">{t.editor.sizing.title}</h2>
        <SizingFields value={sizing} onChange={setSizing} />
      </section>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <h2 className="text-sm font-medium">{t.editor.exit.title}</h2>
        {exit.map((rule, index) => (
          <ExitRuleRow
            key={index}
            index={index}
            value={rule}
            onChange={(next) => {
              setExit(exit.map((r, i) => (i === index ? next : r)));
            }}
            onRemove={() => {
              setExit(exit.filter((_, i) => i !== index));
            }}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setExit([...exit, { kind: "days_before_expiry", businessDays: 3 }]);
          }}
        >
          {t.editor.exit.addRule}
        </Button>
      </section>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{t.editor.adjustments.title}</h2>
          <p className="text-muted-foreground text-xs">{t.editor.adjustments.subtitle}</p>
        </div>
        {adjustments.map((adjustment, index) => (
          <AdjustmentRow
            key={index}
            index={index}
            value={adjustment}
            onChange={(next) => {
              setAdjustments(adjustments.map((a, i) => (i === index ? next : a)));
            }}
            onRemove={() => {
              setAdjustments(adjustments.filter((_, i) => i !== index));
            }}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setAdjustments([
              ...adjustments,
              {
                kind: "roll",
                when: { kind: "days_before_expiry", businessDays: 3 },
                expiry: defaultExpiry,
                strikes: [],
              },
            ]);
          }}
        >
          {t.editor.adjustments.addAdjustment}
        </Button>
      </section>

      <div className="flex gap-2">
        <Button type="button" onClick={submit} disabled={pending}>
          {strategyId ? t.editor.submit.save : t.editor.submit.create}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            router.push("/estrategias");
          }}
        >
          {t.editor.cancel}
        </Button>
      </div>
    </div>
  );
}
