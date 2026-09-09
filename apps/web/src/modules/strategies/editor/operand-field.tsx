"use client";

import {
  indicatorKinds,
  priceFields,
  type DecimalString,
  type IndicatorSpec,
  type Operand,
} from "@fetha/contracts";

import { Input } from "@/components/ui/input";

import { t } from "../strings";
import { SimpleSelect } from "./simple-select";

const operandKinds = ["indicator", "price", "constant"] as const;

function defaultIndicator(): IndicatorSpec {
  return { kind: "sma", length: 20 };
}

export function OperandField({
  value,
  onChange,
  label,
}: {
  value: Operand;
  onChange: (value: Operand) => void;
  label: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <SimpleSelect
        ariaLabel={`${label} · ${t.editor.operand.kind}`}
        value={value.kind}
        onValueChange={(kind) => {
          if (kind === "indicator") {
            onChange({ kind: "indicator", indicator: defaultIndicator() });
          } else if (kind === "price") {
            onChange({ kind: "price", field: "close" });
          } else {
            onChange({ kind: "constant", value: "0" as DecimalString });
          }
        }}
        options={operandKinds.map((kind) => ({ value: kind, label: t.operandKinds[kind] }))}
      />

      {value.kind === "indicator" && (
        <div className="flex gap-1.5">
          <SimpleSelect
            ariaLabel={`${label} · ${t.editor.operand.indicatorKind}`}
            value={value.indicator.kind}
            onValueChange={(kind) => {
              if (kind === "iv_rank") {
                onChange({
                  kind: "indicator",
                  indicator: { kind: "iv_rank", lookbackSessions: 252 },
                });
              } else {
                onChange({
                  kind: "indicator",
                  indicator: { kind: kind as "sma" | "ema" | "rsi" | "atr", length: 20 },
                });
              }
            }}
            options={indicatorKinds.map((kind) => ({ value: kind, label: t.indicatorKinds[kind] }))}
          />
          {value.indicator.kind === "iv_rank" ? (
            <Input
              type="number"
              min={2}
              aria-label={`${label} · ${t.editor.operand.indicatorLookback}`}
              value={value.indicator.lookbackSessions}
              onChange={(event) => {
                onChange({
                  kind: "indicator",
                  indicator: {
                    kind: "iv_rank",
                    lookbackSessions: Number(event.target.value),
                  },
                });
              }}
            />
          ) : (
            <Input
              type="number"
              min={1}
              aria-label={`${label} · ${t.editor.operand.indicatorLength}`}
              value={value.indicator.length}
              onChange={(event) => {
                if (value.indicator.kind === "iv_rank") {
                  return;
                }
                onChange({
                  kind: "indicator",
                  indicator: { kind: value.indicator.kind, length: Number(event.target.value) },
                });
              }}
            />
          )}
        </div>
      )}

      {value.kind === "price" && (
        <SimpleSelect
          ariaLabel={`${label} · ${t.editor.operand.priceField}`}
          value={value.field}
          onValueChange={(field) => {
            onChange({ kind: "price", field: field as (typeof priceFields)[number] });
          }}
          options={priceFields.map((field) => ({ value: field, label: t.priceFields[field] }))}
        />
      )}

      {value.kind === "constant" && (
        <Input
          aria-label={`${label} · ${t.editor.operand.constantValue}`}
          value={value.value}
          onChange={(event) => {
            onChange({ kind: "constant", value: event.target.value as DecimalString });
          }}
        />
      )}
    </div>
  );
}
