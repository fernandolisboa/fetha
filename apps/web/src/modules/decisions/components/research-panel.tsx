"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { analysisVerdicts, type AnalysisVerdictDecision } from "@fetha/contracts";

import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatBRL } from "@/lib/format/brl";
import { formatDate, formatSessionDate, formatTime } from "@/lib/format/date-time";
import { modelDisplayName } from "@/modules/ai-models/client";
import { DEFAULT_RISK_PROFILE } from "@/modules/portfolio/client";
import {
  RESEARCH_WINDOW_SESSIONS,
  ResearchIdeaCard,
  radarT,
  researchSummary,
} from "@/modules/radar/client";

import { allowedDecisionKinds } from "../allowed-kinds";
import { obtainSuggestionsAction, type EngineResearchView } from "../research-actions";
import { applyObtained, initialPanelState, type ResearchPanelState } from "../research-panel-state";
import type { ResearchIdeaView, ResearchView } from "../research-view";
import { t } from "../strings";
import { DecisionBar } from "./decision-bar";

const GRID = "grid gap-3 @min-[56rem]:grid-cols-2 @min-[120rem]:grid-cols-3";

function Notes({
  usingDefaultProfile,
  timedOut,
}: {
  usingDefaultProfile: boolean;
  timedOut: boolean;
}) {
  const strings = radarT.research;
  return (
    <>
      {timedOut && (
        <p className="text-[13px] text-pretty" style={{ color: "var(--warning)" }}>
          {strings.timedOut}
        </p>
      )}
      {usingDefaultProfile && (
        <p className="text-muted-foreground text-xs text-pretty">
          {strings.defaultProfile(formatBRL(DEFAULT_RISK_PROFILE.declaredCapital))}{" "}
          <Link
            href="/configuracoes/risco"
            className="text-primary underline-offset-4 hover:underline"
          >
            {strings.declareProfile}
          </Link>
        </p>
      )}
    </>
  );
}

function EngineGroup({
  title,
  ideas,
  stale = false,
}: {
  title: string;
  ideas: EngineResearchView["holding"];
  stale?: boolean;
}) {
  if (ideas.length === 0) return null;
  return (
    <section className="@container flex flex-col gap-3" aria-label={title}>
      <h3 className="text-[15px] font-medium">
        {title} <span className="text-muted-foreground font-mono tabular-nums">{ideas.length}</span>
      </h3>
      <div className={GRID}>
        {ideas.map((idea) => (
          <ResearchIdeaCard key={`${idea.underlying}-${idea.recipeId}`} idea={idea} stale={stale} />
        ))}
      </div>
    </section>
  );
}

function EngineResult({ engine }: { engine: EngineResearchView }) {
  const strings = radarT.research;
  const found = engine.holding.length + engine.noLongerHolding.length > 0;
  return (
    <div className="flex flex-col gap-3" data-testid="research-result">
      <Notes usingDefaultProfile={engine.usingDefaultProfile} timedOut={engine.timedOut} />
      {!found && !engine.timedOut && (
        <p className="text-[13px] text-pretty">
          {engine.sessionsLooked === 0 ? strings.noRadar : strings.empty(RESEARCH_WINDOW_SESSIONS)}
        </p>
      )}
      <EngineGroup title={strings.holdingTitle} ideas={engine.holding} />
      <EngineGroup title={strings.noLongerTitle} ideas={engine.noLongerHolding} stale />
    </div>
  );
}

function AiAlerts({ idea }: { idea: ResearchIdeaView }) {
  if (idea.aiAlerts.length === 0) return null;
  return (
    <ul aria-label={t.research.aiAlertsLabel} className="flex flex-wrap gap-1.5">
      {idea.aiAlerts.map((alert) => (
        <li
          key={alert}
          className="border-primary text-primary rounded-[var(--radius)] border px-2 py-0.5 text-xs"
          data-testid="research-ai-alert"
        >
          {t.research.aiAlerts[alert]}
        </li>
      ))}
    </ul>
  );
}

function Opinion({ idea }: { idea: ResearchIdeaView }) {
  return (
    <div className="flex flex-col gap-2" data-testid="research-opinion">
      <p className="text-[13px] text-pretty">{idea.justification}</p>
      <AiAlerts idea={idea} />
      {idea.cited.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: "group/cited -ml-2 max-md:min-h-11",
            })}
          >
            {t.research.citedToggle}
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-data-[panel-open]/cited:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
              {idea.cited.map((fact, index) => (
                <div key={`${fact.label}-${String(index)}`} className="contents">
                  <dt className="text-muted-foreground">{fact.label}</dt>
                  <dd className="font-mono tabular-nums">{fact.value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function IdeaActions({
  idea,
  supersededBy,
}: {
  idea: ResearchIdeaView;
  supersededBy: ResearchView["supersededBy"];
}) {
  return (
    <>
      <Link
        href={`/carteira/nova-operacao?pesquisa=${idea.id}`}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "max-md:min-h-11" })}
      >
        {radarT.suggestions.actions.builder}
      </Link>
      {idea.decision ? (
        <span className="text-muted-foreground text-xs" data-testid="research-decision">
          {radarT.suggestions.answered(
            t.kind[idea.decision.kind],
            formatDate(idea.decision.decidedAt),
          )}
        </span>
      ) : supersededBy ? (
        <span className="text-muted-foreground text-xs" data-testid="research-archived">
          {t.research.archived(formatSessionDate(supersededBy))}
        </span>
      ) : (
        <DecisionBar
          originKind="research_idea"
          targetId={idea.id}
          allowedKinds={allowedDecisionKinds({ kind: "research_idea" })}
          defaultHorizon={idea.defaultHorizon}
          defaultInstrument={idea.card.underlying}
        />
      )}
    </>
  );
}

function VerdictCards({ research, ideas }: { research: ResearchView; ideas: ResearchIdeaView[] }) {
  return (
    <div className={GRID}>
      {ideas.map((idea) => (
        <ResearchIdeaCard
          key={idea.id}
          idea={idea.card}
          stale={idea.card.alerts.some((alert) => alert.kind === "rule_no_longer_holds")}
          title={t.research.headline[idea.verdict](idea.card.structure.name, idea.card.underlying)}
          opinion={<Opinion idea={idea} />}
          actions={<IdeaActions idea={idea} supersededBy={research.supersededBy} />}
        />
      ))}
    </div>
  );
}

function VerdictGroup({
  research,
  verdict,
}: {
  research: ResearchView;
  verdict: AnalysisVerdictDecision;
}) {
  const ideas = research.groups[verdict];
  if (ideas.length === 0) return null;
  const title = t.research.groups[verdict];
  if (verdict === "do_not_enter") {
    return (
      <Collapsible className="@container flex flex-col gap-3" data-testid="research-discarded">
        <CollapsibleTrigger
          className={buttonVariants({
            variant: "outline",
            size: "sm",
            className: "group/discarded self-start max-md:min-h-11",
          })}
        >
          {t.research.discarded(ideas.length)}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-data-[panel-open]/discarded:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <section className="flex flex-col gap-3" aria-label={title}>
            <h3 className="text-[15px] font-medium">
              {title}{" "}
              <span className="text-muted-foreground font-mono tabular-nums">{ideas.length}</span>
            </h3>
            <VerdictCards research={research} ideas={ideas} />
          </section>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  return (
    <section className="@container flex flex-col gap-3" aria-label={title}>
      <h3 className="text-[15px] font-medium">
        {title} <span className="text-muted-foreground font-mono tabular-nums">{ideas.length}</span>
      </h3>
      <VerdictCards research={research} ideas={ideas} />
    </section>
  );
}

function ResearchResult({
  research,
  engine,
}: {
  research: ResearchView;
  engine: EngineResearchView | null;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="research-result">
      <p className="text-muted-foreground text-xs text-pretty" data-testid="research-stamp">
        {t.research.researchedAt(
          formatDate(research.createdAt),
          formatTime(research.createdAt),
          modelDisplayName(research.model),
        )}
      </p>
      <Notes
        usingDefaultProfile={research.usingDefaultProfile}
        timedOut={engine?.timedOut ?? false}
      />
      <section className="flex flex-col gap-1" aria-label={t.research.overviewTitle}>
        <h3 className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t.research.overviewTitle}
        </h3>
        <p className="text-[13px] text-pretty" data-testid="research-overview">
          {research.overview}
        </p>
      </section>
      {research.groups.enter.length === 0 && (
        <p className="text-[13px] font-medium text-pretty" data-testid="research-none-worth-it">
          {t.research.noneWorthIt(research.candidates, research.sessionsLooked)}
        </p>
      )}
      {analysisVerdicts.map((verdict) => (
        <VerdictGroup key={verdict} research={research} verdict={verdict} />
      ))}
      {research.unsent.length > 0 && (
        <section className="@container flex flex-col gap-3" aria-label={t.research.unsentTitle}>
          <p className="text-muted-foreground text-xs text-pretty" data-testid="research-unsent">
            {t.research.unsent(research.unsent.length)}
          </p>
          <div className={GRID}>
            {research.unsent.map((idea) => (
              <ResearchIdeaCard key={`${idea.underlying}-${idea.recipeId}`} idea={idea} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function NoticeLine({ state }: { state: ResearchPanelState }) {
  const notice = state.notice;
  if (!notice) return null;
  const strings = t.research.notices;
  switch (notice.kind) {
    case "no_key":
      return (
        <>
          {strings.noKeyBefore}
          <Link
            href="/configuracoes/ia"
            className="text-primary underline-offset-4 hover:underline"
          >
            {strings.noKeyLink}
          </Link>
        </>
      );
    case "key_unreadable":
      return (
        <>
          {strings.keyUnreadableBefore}
          <Link
            href="/configuracoes/ia"
            className="text-primary underline-offset-4 hover:underline"
          >
            {strings.noKeyLink}
          </Link>
        </>
      );
    case "cap_reached":
      return strings.cap(notice.cap);
    case "rate_limited":
      return strings.rate_limited;
    case "failed":
      return strings.failed;
  }
}

export function ResearchPanel({ stored }: { stored: ResearchView | null }) {
  const [state, setState] = useState<ResearchPanelState>(() => initialPanelState(stored));
  const [pending, setPending] = useState(false);

  async function research() {
    setPending(true);
    try {
      const outcome = await obtainSuggestionsAction();
      setState((previous) => applyObtained(previous, outcome));
    } catch {
      setState((previous) => applyObtained(previous, { status: "error", error: "unavailable" }));
    } finally {
      setPending(false);
    }
  }

  const summary = state.research ?? state.engine;
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
          {pending
            ? t.research.pending
            : state.research
              ? t.research.again
              : radarT.research.button}
        </Button>
        <p
          aria-live="polite"
          className="text-[13px] text-pretty empty:hidden"
          style={{ color: "var(--danger)" }}
        >
          {state.error ? radarT.research.errors[state.error] : null}
        </p>
      </div>
      <p
        aria-live="polite"
        className="text-muted-foreground text-[13px] text-pretty empty:hidden"
        data-testid="research-notice"
      >
        <NoticeLine state={state} />
      </p>
      <p
        aria-live="polite"
        className="text-muted-foreground text-xs text-pretty empty:hidden"
        data-testid="research-summary"
      >
        {summary
          ? `${summary.newestClose ? `${radarT.research.close(formatSessionDate(summary.newestClose))}. ` : ""}${researchSummary(summary)}`
          : null}
      </p>
      {state.research ? (
        <ResearchResult research={state.research} engine={state.engine} />
      ) : state.engine ? (
        <EngineResult engine={state.engine} />
      ) : null}
    </div>
  );
}
