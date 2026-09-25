"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecisionKind } from "@fetha/engine";
import { thesisClaimKinds, tickerSchema } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { recordDecisionAction, type RecordDecisionActionInput } from "../actions";
import type { JournalOriginKind } from "../allowed-kinds";
import { parseConfidencePercent } from "../parse-confidence";
import { parseLevelInput } from "../parse-level";
import { t } from "../strings";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";

type ThesisClaimKind = (typeof thesisClaimKinds)[number];

const CLAIM_KINDS: readonly (ThesisClaimKind | "none")[] = ["none", ...thesisClaimKinds];

interface DecisionBarProps {
  originKind: JournalOriginKind;
  targetId: string;
  allowedKinds: readonly DecisionKind[];
  defaultHorizon: string | null;
  defaultInstrument: string;
}

// DESIGN.md's DecisionBar, opened from a per-row "Registrar decisão" button
// inside a Dialog (brief item 6): DESIGN.md's own "one decision bar per
// screen" would otherwise conflict with a bar on every unanswered
// SignalRow/contemplated operation.
export function DecisionBar({
  originKind,
  targetId,
  allowedKinds,
  defaultHorizon,
  defaultInstrument,
}: DecisionBarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DecisionKind | null>(allowedKinds[0] ?? null);
  const [rationale, setRationale] = useState("");
  const [claimKind, setClaimKind] = useState<ThesisClaimKind | "none">("none");
  const [instrument, setInstrument] = useState(defaultInstrument);
  const [level, setLevel] = useState("");
  const [confidencePercent, setConfidencePercent] = useState("");
  const [horizon, setHorizon] = useState(defaultHorizon ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confidence = parseConfidencePercent(confidencePercent);
  const parsedLevel = parseLevelInput(level);
  const instrumentValid = tickerSchema.safeParse(instrument).success;
  const claimValid =
    claimKind === "none" ||
    claimKind === "operation_pnl_positive" ||
    (instrumentValid && parsedLevel !== null);
  const today = todaySaoPauloDate();
  const horizonValid = horizon !== "" && horizon >= today;
  const canSubmit =
    kind !== null && rationale.trim() !== "" && confidence !== null && horizonValid && claimValid;

  function reset() {
    setKind(allowedKinds[0] ?? null);
    setRationale("");
    setClaimKind("none");
    setInstrument(defaultInstrument);
    setLevel("");
    setConfidencePercent("");
    setHorizon(defaultHorizon ?? "");
    setError(null);
  }

  function submit() {
    if (
      kind === null ||
      confidence === null ||
      rationale.trim() === "" ||
      !horizonValid ||
      !claimValid
    ) {
      return;
    }
    if (parsedLevel === null && (claimKind === "close_above" || claimKind === "close_below")) {
      return;
    }
    const resolvedLevel = parsedLevel;
    const claim: RecordDecisionActionInput["claim"] =
      claimKind === "none"
        ? null
        : claimKind === "operation_pnl_positive"
          ? { kind: "operation_pnl_positive" }
          : resolvedLevel === null
            ? null
            : { kind: claimKind, instrument, level: resolvedLevel };
    if (claim === null && claimKind !== "none") {
      return;
    }

    setPending(true);
    setError(null);
    startTransition(() => {
      recordDecisionAction({
        originKind,
        targetId,
        kind,
        rationale,
        claim,
        confidence,
        horizon,
      })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            setOpen(false);
            reset();
            router.refresh();
          } else {
            setError(t.errors[result.error]);
          }
        })
        .catch(() => {
          setPending(false);
          setError(t.errors.unavailable);
        });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        {t.form.trigger}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.form.title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            {allowedKinds.map((candidate) => (
              <Button
                key={candidate}
                type="button"
                size="sm"
                variant={kind === candidate ? "default" : "outline"}
                onClick={() => {
                  setKind(candidate);
                }}
              >
                {t.kind[candidate]}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="decision-rationale">{t.form.rationale}</Label>
            <Textarea
              id="decision-rationale"
              value={rationale}
              placeholder={t.form.rationalePlaceholder}
              onChange={(event) => {
                setRationale(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label>{t.claim.label}</Label>
            <Select
              value={claimKind}
              onValueChange={(next) => {
                if (typeof next === "string") {
                  setClaimKind(next);
                }
              }}
            >
              <SelectTrigger aria-label={t.claim.label} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLAIM_KINDS.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {t.claim[candidate]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(claimKind === "close_above" || claimKind === "close_below") && (
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="decision-claim-instrument">{t.claim.instrument}</Label>
                <Input
                  id="decision-claim-instrument"
                  aria-invalid={!instrumentValid}
                  value={instrument}
                  onChange={(event) => {
                    setInstrument(event.target.value.toUpperCase());
                  }}
                />
                {!instrumentValid && (
                  <p className="text-destructive text-xs">{t.form.invalidInstrument}</p>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="decision-claim-level">{t.claim.level}</Label>
                <Input
                  id="decision-claim-level"
                  aria-invalid={level !== "" && parsedLevel === null}
                  value={level}
                  onChange={(event) => {
                    setLevel(event.target.value);
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="decision-confidence">{t.form.confidence}</Label>
              <Input
                id="decision-confidence"
                aria-invalid={confidencePercent !== "" && confidence === null}
                value={confidencePercent}
                onChange={(event) => {
                  setConfidencePercent(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="decision-horizon">{t.form.horizon}</Label>
              <Input
                id="decision-horizon"
                type="date"
                aria-invalid={horizon !== "" && !horizonValid}
                value={horizon}
                onChange={(event) => {
                  setHorizon(event.target.value);
                }}
              />
              {horizon !== "" && !horizonValid && (
                <p className="text-destructive text-xs">{t.form.invalidHorizon}</p>
              )}
            </div>
          </div>

          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t.form.cancel}
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!canSubmit || pending}>
            {t.form.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
