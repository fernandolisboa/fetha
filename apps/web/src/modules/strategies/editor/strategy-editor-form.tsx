"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  decimalStringSchema,
  strategyDefinitionSchema,
  timeframes,
  type AdjustmentRule,
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
import { Panel } from "@/modules/shell";

import {
  addStrategyVersionAction,
  createStrategyAction,
  type StrategyActionResult,
} from "../actions";
import { t } from "../strings";
import { AdjustmentRow } from "./adjustment-row";
import { fromEditableEntry, toEditableEntry, type EditableEntry } from "./compare-conditions";
import { ConditionRow } from "./condition-row";
import { defaultCompareCondition } from "./defaults";
import { ExpiryFields } from "./expiry-fields";
import { ExitRuleRow } from "./exit-rule-row";
import { FieldValidityProvider } from "./field-validity";
import { SimpleSelect } from "./simple-select";
import { SizingFields } from "./sizing-fields";
import { StrikeList } from "./strike-list";

const defaultExpiry: ExpirySelection = { kind: "business_days", min: 5, max: 20 };

function newStrikeForAdjustment(): StrikeSelection {
  return { kind: "delta", target: decimalStringSchema.parse("0.3") };
}

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
  const [entry, setEntry] = useState<EditableEntry>(
    initial
      ? toEditableEntry(initial.entry)
      : { editable: true, conditions: [defaultCompareCondition] },
  );
  const [strikes, setStrikes] = useState<StrikeSelection[]>(initial?.strikes ?? []);
  const [expiry, setExpiry] = useState<ExpirySelection>(initial?.expiry ?? defaultExpiry);
  const [sizing, setSizing] = useState<SizingRule>(
    initial?.sizing ?? { kind: "fixed_fractional", fraction: decimalStringSchema.parse("0.1") },
  );
  const [exit, setExit] = useState<ExitRule[]>(initial?.exit ?? []);
  const [adjustments, setAdjustments] = useState<AdjustmentRule[]>(initial?.adjustments ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [anyFieldInvalid, setAnyFieldInvalid] = useState(false);

  function buildDefinition(): StrategyDefinition {
    return {
      name,
      timeframe,
      entry: fromEditableEntry(entry),
      structureId,
      strikes,
      expiry: strikes.length > 0 ? expiry : undefined,
      sizing,
      exit,
      adjustments,
    };
  }

  function errorMessage(result: Extract<StrategyActionResult, { status: "error" }>): string {
    return t.editor.errors[result.error];
  }

  function submit() {
    if (anyFieldInvalid) {
      setError(t.editor.errors.invalid);
      return;
    }
    const definition = buildDefinition();
    const parsed = strategyDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      setError(t.editor.errors.invalid);
      return;
    }
    setError(null);
    setPending(true);
    startTransition(() => {
      const action = strategyId
        ? addStrategyVersionAction({ strategyId, definition: parsed.data })
        : createStrategyAction({ definition: parsed.data });
      action
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            router.push(`/estrategias/${result.strategyId}`);
          } else {
            setError(errorMessage(result));
          }
        })
        .catch(() => {
          setPending(false);
          setError(t.editor.errors.unavailable);
        });
    });
  }

  return (
    <FieldValidityProvider onAnyInvalidChange={setAnyFieldInvalid}>
      <div className="flex flex-col gap-6">
        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="strategy-name">{t.editor.name.label}</Label>
            <Input
              id="strategy-name"
              value={name}
              maxLength={120}
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
              onValueChange={setTimeframe}
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

        <Panel title={t.editor.entry.title} subtitle={t.editor.entry.subtitle}>
          {entry.editable ? (
            <>
              {entry.conditions.map((condition, index) => (
                <ConditionRow
                  key={index}
                  value={condition}
                  removable={entry.conditions.length > 1}
                  onChange={(next) => {
                    setEntry({
                      editable: true,
                      conditions: entry.conditions.map((c, i) => (i === index ? next : c)),
                    });
                  }}
                  onRemove={() => {
                    setEntry({
                      editable: true,
                      conditions: entry.conditions.filter((_, i) => i !== index),
                    });
                  }}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => {
                  setEntry({
                    editable: true,
                    conditions: [...entry.conditions, defaultCompareCondition],
                  });
                }}
              >
                {t.editor.entry.addCondition}
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t.editor.entry.readOnlyNotice}</p>
          )}
        </Panel>

        <Panel title={t.editor.strikes.title} subtitle={t.editor.strikes.subtitle}>
          <StrikeList strikes={strikes} onChange={setStrikes} />
          {strikes.length > 0 && (
            <div>
              <h3 className="text-[13px] font-medium">{t.editor.expiry.title}</h3>
              <ExpiryFields value={expiry} onChange={setExpiry} />
            </div>
          )}
        </Panel>

        <Panel title={t.editor.sizing.title}>
          <SizingFields value={sizing} onChange={setSizing} />
        </Panel>

        <Panel title={t.editor.exit.title}>
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
        </Panel>

        <Panel title={t.editor.adjustments.title} subtitle={t.editor.adjustments.subtitle}>
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
                  strikes: [newStrikeForAdjustment()],
                },
              ]);
            }}
          >
            {t.editor.adjustments.addAdjustment}
          </Button>
        </Panel>

        <div className="flex gap-2">
          <Button type="button" onClick={submit} disabled={pending || anyFieldInvalid}>
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
    </FieldValidityProvider>
  );
}
