"use client";

import { startTransition, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  quantitySchema,
  tickerSchema,
  type ContemplatedLeg,
  type Structure,
} from "@fetha/contracts";
import type { LimitBreach, NoteCode, OperationPricing } from "@fetha/engine";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Panel } from "@/modules/shell/client";

import { loadChainAction, priceOperationAction, saveOperationAction } from "../operations-actions";
import { t } from "../strings";
import { GreeksPanel } from "./greeks-panel";
import { LegsTable } from "./legs-table";
import { PayoffChart } from "./payoff-chart";
import { RiskNotice } from "./risk-notice";
import { StatBlocks } from "./stat-blocks";
import type { BuilderLeg, ChainSeries } from "./types";

const DISPLAYED_NOTE_CODES = [
  "no_market_price",
  "risk_free_rate_defaulted",
  "dividend_yield_defaulted",
  "iv_not_converged",
  "stale_price",
] as const satisfies readonly NoteCode[];

function legsForStructure(structure: Structure, underlying: string): BuilderLeg[] {
  return structure.legs.map((template) => ({
    template,
    leg:
      template.role === "stock" && tickerSchema.safeParse(underlying).success
        ? {
            role: "stock",
            side: template.side,
            ticker: underlying,
            quantity: quantitySchema.parse(template.ratio),
          }
        : null,
    valuation: null,
  }));
}

function readyToPrice(legs: BuilderLeg[]): ContemplatedLeg[] | null {
  const result: ContemplatedLeg[] = [];
  for (const builderLeg of legs) {
    if (!builderLeg.leg) return null;
    result.push(builderLeg.leg);
  }
  return result;
}

function applyValuations(legs: BuilderLeg[], pricing: OperationPricing): BuilderLeg[] {
  return legs.map((builderLeg, index) => ({
    ...builderLeg,
    valuation: pricing.legs[index] ?? null,
  }));
}

function breachSignature(breaches: LimitBreach[]): string {
  return breaches
    .map((breach) => breach.limit)
    .sort()
    .join(",");
}

export function OperationBuilderForm({
  structures,
  hasRiskProfile,
}: {
  structures: Structure[];
  hasRiskProfile: boolean;
}) {
  const router = useRouter();
  const [structureId, setStructureId] = useState(structures[0]?.id ?? "");
  const structure = structures.find((candidate) => candidate.id === structureId) ?? structures[0];
  const [underlying, setUnderlying] = useState("");
  const [chain, setChain] = useState<ChainSeries[]>([]);
  const [legs, setLegs] = useState<BuilderLeg[]>(structure ? legsForStructure(structure, "") : []);
  const [pricing, setPricing] = useState<OperationPricing | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pricingRequestId = useRef(0);
  const chainRequestId = useRef(0);

  // Any edit invalidates whatever pricing request is still in flight (round
  // 2 item 3): without this, a slow response from a leg set the user has
  // since changed can still land and repaint StatBlocks/Greeks for legs no
  // longer on screen, because `price()` alone only ever compares against
  // the request it itself started.
  function invalidateInFlightPricing() {
    pricingRequestId.current += 1;
  }

  function resetPricingState() {
    invalidateInFlightPricing();
    setPricing(null);
    setSavedId(null);
  }

  function selectStructure(nextId: string) {
    setStructureId(nextId);
    const next = structures.find((candidate) => candidate.id === nextId);
    setLegs(next ? legsForStructure(next, underlying) : []);
    resetPricingState();
  }

  async function loadUnderlying(nextUnderlying: string) {
    setUnderlying(nextUnderlying);
    resetPricingState();
    if (!structure) return;
    setLegs(legsForStructure(structure, nextUnderlying));
    // Sequenced against `chainRequestId` (round 2 item 3): blurring PETR4
    // then VALE3 must not let a slow PETR4 chain response land after
    // VALE3's own, faster one, and repaint the picker for the wrong
    // underlying.
    const requestId = chainRequestId.current + 1;
    chainRequestId.current = requestId;
    if (tickerSchema.safeParse(nextUnderlying).success) {
      const series = await loadChainAction(nextUnderlying);
      if (chainRequestId.current !== requestId) return;
      setChain(series);
    } else {
      if (chainRequestId.current !== requestId) return;
      setChain([]);
    }
  }

  function changeTicker(index: number, ticker: string) {
    setLegs((current) =>
      current.map((builderLeg, position) =>
        position === index
          ? {
              ...builderLeg,
              leg: {
                role: builderLeg.template.role,
                side: builderLeg.template.side,
                ticker,
                quantity:
                  builderLeg.leg?.quantity ?? quantitySchema.parse(builderLeg.template.ratio),
              },
              valuation: null,
            }
          : builderLeg,
      ),
    );
    resetPricingState();
  }

  function changeQuantity(index: number, quantity: number) {
    setLegs((current) =>
      current.map((builderLeg, position) =>
        position === index && builderLeg.leg
          ? { ...builderLeg, leg: { ...builderLeg.leg, quantity: quantitySchema.parse(quantity) } }
          : builderLeg,
      ),
    );
    resetPricingState();
  }

  function price() {
    const readyLegs = readyToPrice(legs);
    if (!readyLegs || !tickerSchema.safeParse(underlying).success) {
      setPriceError(t.builder.priceError);
      return;
    }
    setPriceError(null);
    setSaveError(null);
    setSavedId(null);
    setPending(true);
    const requestId = pricingRequestId.current + 1;
    pricingRequestId.current = requestId;
    startTransition(() => {
      priceOperationAction({ underlying, legs: readyLegs })
        .then((result) => {
          if (pricingRequestId.current !== requestId) return;
          setPending(false);
          if (result.status === "ok") {
            setPricing(result.pricing);
            setLegs((current) => applyValuations(current, result.pricing));
          } else {
            setPricing(null);
            setPriceError(t.builder.priceError);
          }
        })
        .catch(() => {
          if (pricingRequestId.current !== requestId) return;
          setPending(false);
          setPriceError(t.builder.priceError);
        });
    });
  }

  function persist(readyLegs: ContemplatedLeg[]) {
    if (!structure) return;
    startTransition(() => {
      saveOperationAction({ structureId: structure.id, underlying, legs: readyLegs })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            setSavedId(result.operationId);
            setPricing(result.pricing);
            setLegs((current) => applyValuations(current, result.pricing));
            router.refresh();
          } else if (result.error === "no_market_price") {
            setSaveError(t.builder.saveErrorNoMarketPrice);
          } else {
            setSaveError(t.builder.saveError);
          }
        })
        .catch(() => {
          setPending(false);
          setSaveError(t.builder.saveError);
        });
    });
  }

  // A second click on an already-saved operation must not write a
  // duplicate row (round 2 item 3): once `savedId` is set the button is
  // disabled below, and this guard covers the click that can still land
  // before that re-render does.
  //
  // Every click re-prices before persisting, because the on-screen pricing
  // can be stale by the time the user commits. If that fresh pricing
  // carries the same set of limit breaches the user is already looking at
  // (including none), the save proceeds in the same click: the breach was
  // seen and confirmed by the "Registrar mesmo assim" click itself. Only
  // when the fresh pricing introduces a breach that was not part of what
  // the user acknowledged does it stop, show the updated notice, and wait
  // for one more explicit click — now checked against that new baseline.
  function save() {
    const readyLegs = readyToPrice(legs);
    if (!readyLegs || !structure || savedId) return;
    setSaveError(null);
    setPending(true);

    const acknowledgedBreaches = breachSignature(pricing?.limitBreaches ?? []);
    const requestId = pricingRequestId.current + 1;
    pricingRequestId.current = requestId;
    startTransition(() => {
      priceOperationAction({ underlying, legs: readyLegs })
        .then((result) => {
          if (pricingRequestId.current !== requestId) return;
          if (result.status !== "ok") {
            setPending(false);
            setSaveError(t.builder.saveError);
            return;
          }
          setPricing(result.pricing);
          setLegs((current) => applyValuations(current, result.pricing));
          const freshBreaches = breachSignature(result.pricing.limitBreaches);
          if (freshBreaches !== acknowledgedBreaches) {
            setPending(false);
            return;
          }
          persist(readyLegs);
        })
        .catch(() => {
          if (pricingRequestId.current !== requestId) return;
          setPending(false);
          setSaveError(t.builder.saveError);
        });
    });
  }

  const showNoRiskProfileChip = pricing
    ? pricing.notes.some((note) => note.code === "no_risk_profile")
    : !hasRiskProfile;

  const hasBreaches = (pricing?.limitBreaches.length ?? 0) > 0;
  const displayedNotes = (pricing?.notes ?? []).filter((note) =>
    (DISPLAYED_NOTE_CODES as readonly string[]).includes(note.code),
  );
  const staleLegCount = (pricing?.legs ?? []).filter((leg) => leg.stale !== null).length;
  const blocksSave = displayedNotes.some((note) => note.code === "no_market_price");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="structure">{t.builder.structure}</Label>
          <Select
            value={structureId}
            onValueChange={(value) => {
              if (value) selectStructure(value);
            }}
          >
            <SelectTrigger id="structure" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {structures.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="underlying">{t.builder.underlying}</Label>
          <Input
            id="underlying"
            className="w-36 font-mono uppercase"
            placeholder={t.builder.underlyingPlaceholder}
            value={underlying}
            onChange={(event) => {
              setUnderlying(event.target.value.toUpperCase());
            }}
            onBlur={(event) => {
              void loadUnderlying(event.target.value.toUpperCase());
            }}
          />
        </div>

        {showNoRiskProfileChip ? (
          <Link href="/configuracoes">
            <Badge
              variant="outline"
              style={{ borderColor: "var(--warning)", color: "var(--warning)" }}
            >
              {t.chip.noRiskProfile}
            </Badge>
          </Link>
        ) : null}

        <Button type="button" onClick={price} disabled={pending} className="ml-auto">
          {pending ? t.builder.pricing : t.builder.price}
        </Button>
      </div>

      {priceError ? <p className="text-destructive text-xs">{priceError}</p> : null}

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-[14px]">
        <div className="flex flex-col gap-[14px]">
          {structure ? (
            <Panel title={t.builder.legsTable.title}>
              <LegsTable
                underlying={underlying}
                legs={legs}
                chain={chain}
                onChangeTicker={changeTicker}
                onChangeQuantity={changeQuantity}
              />
            </Panel>
          ) : null}

          {pricing ? (
            <Panel title={t.builder.payoffChart.pnl}>
              <PayoffChart
                points={pricing.payoff}
                spot={pricing.spot}
                breakEvens={pricing.breakEvens}
              />
            </Panel>
          ) : null}
        </div>

        {pricing ? (
          <div className="flex flex-col gap-[14px]">
            {displayedNotes.length > 0 || staleLegCount > 0 ? (
              <ul
                className="flex flex-col gap-1 rounded-[var(--radius)] border p-3"
                style={{ borderColor: "var(--warning)" }}
              >
                {displayedNotes.map((note) => (
                  <li
                    key={note.code}
                    className="font-mono text-[12px]"
                    style={{ color: "var(--warning)" }}
                  >
                    {t.builder.notes[note.code as (typeof DISPLAYED_NOTE_CODES)[number]]}
                  </li>
                ))}
                {staleLegCount > 0 ? (
                  <li className="font-mono text-[12px]" style={{ color: "var(--warning)" }}>
                    {t.builder.legsTable.stale} ({staleLegCount})
                  </li>
                ) : null}
              </ul>
            ) : null}

            <Panel title={t.builder.statBlocks.title}>
              <StatBlocks
                netPremium={pricing.netPremium}
                maxLoss={pricing.maxLoss}
                maxGain={pricing.maxGain}
                breakEvens={pricing.breakEvens}
              />
            </Panel>

            <Panel title={t.builder.greeksPanel.title}>
              <GreeksPanel greeks={pricing.greeks} />
            </Panel>

            <RiskNotice breaches={pricing.limitBreaches} />

            {saveError ? <p className="text-destructive text-xs">{saveError}</p> : null}
            {savedId ? <p className="text-muted-foreground text-xs">{t.builder.saved}</p> : null}

            <Button
              type="button"
              onClick={save}
              disabled={pending || blocksSave || savedId !== null}
              className="self-start"
            >
              {hasBreaches ? t.builder.riskNotice.recordAnyway : t.builder.save}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
