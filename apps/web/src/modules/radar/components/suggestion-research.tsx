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
import { researchSummary } from "../research-summary";
import { t } from "../strings";
import { ResearchIdeaCard } from "./research-idea-card";

type State =
  | { kind: "idle" }
  | { kind: "done"; result: ResearchResult }
  | { kind: "error"; error: "rate_limited" | "unavailable" };

function IdeaGroup({ title, ideas }: { title: string; ideas: ResearchResult["holding"] }) {
  if (ideas.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h3 className="text-[13px] font-medium">
        {title} <span className="text-muted-foreground font-mono tabular-nums">{ideas.length}</span>
      </h3>
      {ideas.map((idea) => (
        <ResearchIdeaCard key={`${idea.underlying}-${idea.recipeId}`} idea={idea} />
      ))}
    </section>
  );
}

function ResearchResultView({ result }: { result: ResearchResult }) {
  const found = result.holding.length + result.noLongerHolding.length > 0;
  return (
    <div className="flex flex-col gap-3" data-testid="research-result">
      <p className="text-muted-foreground text-xs text-pretty">
        {result.newestClose && `${t.research.close(formatSessionDate(result.newestClose))}. `}
        {researchSummary(result)}
      </p>
      {result.timedOut && (
        <p role="status" className="text-[13px] text-pretty" style={{ color: "var(--warning)" }}>
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
      <IdeaGroup title={t.research.noLongerTitle} ideas={result.noLongerHolding} />
    </div>
  );
}

export function SuggestionResearch() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, setPending] = useState(false);

  async function research() {
    setPending(true);
    try {
      const outcome = await researchSuggestionsAction();
      setState(
        outcome.status === "ok"
          ? { kind: "done", result: outcome.result }
          : { kind: "error", error: outcome.error },
      );
    } catch {
      setState({ kind: "error", error: "unavailable" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="suggestion-research">
      <p className="text-muted-foreground text-xs text-pretty">
        {t.research.hint(RESEARCH_WINDOW_SESSIONS)}
      </p>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void research()}
      >
        {pending ? t.research.pending : t.research.button}
      </Button>
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.kind === "done" && <ResearchResultView result={state.result} />}
        {state.kind === "error" && (
          <p className="text-[13px] text-pretty" style={{ color: "var(--danger)" }}>
            {t.research.errors[state.error]}
          </p>
        )}
      </div>
    </div>
  );
}
