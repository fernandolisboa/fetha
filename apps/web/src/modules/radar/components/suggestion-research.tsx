"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format/brl";
import { formatSessionDate } from "@/lib/format/date-time";
import { DEFAULT_RISK_PROFILE } from "@/modules/portfolio/client";

import type { ResearchResult } from "../research";
import { researchSuggestionsAction } from "../research-actions";
import { RESEARCH_WINDOW_SESSIONS } from "../research-rules";
import { applyOutcome, initialResearchState, type ResearchState } from "../research-state";
import { researchSummary } from "../research-summary";
import { t } from "../strings";
import { ResearchIdeaCard } from "./research-idea-card";

function IdeaGroup({
  title,
  ideas,
  stale = false,
}: {
  title: string;
  ideas: ResearchResult["holding"];
  stale?: boolean;
}) {
  if (ideas.length === 0) return null;
  return (
    <section className="@container flex flex-col gap-3" aria-label={title}>
      <h3 className="text-[15px] font-medium">
        {title} <span className="text-muted-foreground font-mono tabular-nums">{ideas.length}</span>
      </h3>
      <div className="grid gap-3 @min-[56rem]:grid-cols-2 @min-[96rem]:grid-cols-3">
        {ideas.map((idea) => (
          <ResearchIdeaCard key={`${idea.underlying}-${idea.recipeId}`} idea={idea} stale={stale} />
        ))}
      </div>
    </section>
  );
}

function summaryLine(result: ResearchResult): string {
  const close = result.newestClose
    ? `${t.research.close(formatSessionDate(result.newestClose))}. `
    : "";
  return `${close}${researchSummary(result)}`;
}

function ResearchResultView({ result }: { result: ResearchResult }) {
  const found = result.holding.length + result.noLongerHolding.length > 0;
  return (
    <div className="flex flex-col gap-3" data-testid="research-result">
      {result.timedOut && (
        <p className="text-[13px] text-pretty" style={{ color: "var(--warning)" }}>
          {t.research.timedOut}
        </p>
      )}
      {result.usingDefaultProfile && (
        <p className="text-muted-foreground text-xs text-pretty">
          {t.research.defaultProfile(formatBRL(DEFAULT_RISK_PROFILE.declaredCapital))}{" "}
          <Link
            href="/configuracoes/risco"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t.research.declareProfile}
          </Link>
        </p>
      )}
      {!found && !result.timedOut && (
        <p className="text-[13px] text-pretty">
          {result.sessionsLooked === 0
            ? t.research.noRadar
            : t.research.empty(RESEARCH_WINDOW_SESSIONS)}
        </p>
      )}
      <IdeaGroup title={t.research.holdingTitle} ideas={result.holding} />
      <IdeaGroup title={t.research.noLongerTitle} ideas={result.noLongerHolding} stale />
    </div>
  );
}

export function SuggestionResearch() {
  const [state, setState] = useState<ResearchState>(initialResearchState);
  const [pending, setPending] = useState(false);

  async function research() {
    setPending(true);
    try {
      const outcome = await researchSuggestionsAction();
      setState((previous) => applyOutcome(previous, outcome));
    } catch {
      setState((previous) => applyOutcome(previous, { status: "error", error: "unavailable" }));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="suggestion-research">
      <p className="text-muted-foreground text-xs text-pretty">
        {t.research.hint(RESEARCH_WINDOW_SESSIONS)}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          variant="outline"
          className="max-md:min-h-11"
          disabled={pending}
          aria-busy={pending}
          onClick={() => void research()}
        >
          {pending ? t.research.pending : t.research.button}
        </Button>
        <p
          aria-live="polite"
          className="text-[13px] text-pretty empty:hidden"
          style={{ color: "var(--danger)" }}
        >
          {state.error ? t.research.errors[state.error] : null}
        </p>
      </div>
      <p aria-live="polite" className="text-muted-foreground text-xs text-pretty empty:hidden">
        {state.result ? summaryLine(state.result) : null}
      </p>
      {state.result && <ResearchResultView result={state.result} />}
    </div>
  );
}
