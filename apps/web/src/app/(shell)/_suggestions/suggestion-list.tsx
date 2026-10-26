import { Fragment } from "react";
import Link from "next/link";
import { tickerSchema } from "@fetha/contracts";

import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/format/date-time";
import { isAnalysisAvailable } from "@/modules/ai-models";
import {
  allowedDecisionKinds,
  getMyAnalysisUsage,
  getMyDecisionsBySuggestionId,
  getMyLatestAnalyses,
  t as decisionsT,
} from "@/modules/decisions";
import { AnalysisDialog, DecisionBar } from "@/modules/decisions/client";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { getMyLimitBreaches, RiskNotice, type LimitCheckResult } from "@/modules/portfolio";
import { SuggestionCard, t, type SuggestionView } from "@/modules/radar";

function LimitCheck({ result }: { result: LimitCheckResult }) {
  switch (result.kind) {
    case "no_risk_profile":
      return (
        <p className="text-muted-foreground text-xs">
          <Link
            href="/configuracoes/risco"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t.suggestions.noRiskProfile}
          </Link>
        </p>
      );
    case "unpriced":
      return null;
    case "checked":
      return result.breaches.length > 0 ? (
        <RiskNotice breaches={result.breaches} />
      ) : (
        <p className="text-muted-foreground text-xs">{t.suggestions.withinLimits}</p>
      );
  }
}

// The suggestion cards with the viewer's own layer on top (docs/adr/0067): their risk check,
// their decision on each (none on an archived one, docs/adr/0072) and the analysis they may ask
// for. `onPage` drops the link to the suggestion's own page, and the card's headline, when the
// card is that page.
export async function SuggestionList({
  suggestions,
  onPage = false,
}: {
  suggestions: SuggestionView[];
  onPage?: boolean;
}) {
  const ids = suggestions.map((suggestion) => suggestion.id);
  const [decisions, analyses, usage, checks] = await Promise.all([
    getMyDecisionsBySuggestionId(ids),
    getMyLatestAnalyses("suggestion", ids),
    getMyAnalysisUsage(),
    getMyLimitBreaches(
      suggestions.map((suggestion) => ({
        underlying: tickerSchema.parse(suggestion.underlying),
        legs: suggestion.entryLegs.map(({ role, side, ticker, quantity }) => ({
          role,
          side,
          ticker,
          quantity,
        })),
        at: suggestion.pricing.at,
      })),
    ),
  ]);
  const available = await isAnalysisAvailable();

  return suggestions.map((suggestion, index) => {
    const decision = decisions.get(suggestion.id);
    const card = (
      <SuggestionCard
        suggestion={suggestion}
        headline={!onPage}
        risk={<LimitCheck result={checks[index] ?? { kind: "unpriced" }} />}
        actions={
          <>
            {!onPage && (
              <Link
                href={`/sugestoes/${suggestion.id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t.suggestions.actions.recipe}
              </Link>
            )}
            <Link
              href={`/carteira/nova-operacao?sugestao=${suggestion.id}`}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t.suggestions.actions.builder}
            </Link>
            <AnalysisDialog
              subjectKind="suggestion"
              subjectId={suggestion.id}
              latest={analyses.get(suggestion.id) ?? null}
              usage={usage}
              available={available}
            />
            {decision ? (
              <span className="text-muted-foreground text-xs" data-testid="suggestion-decision">
                {t.suggestions.answered(
                  decisionsT.kind[decision.kind],
                  formatDate(decision.decidedAt),
                )}
              </span>
            ) : suggestion.window.archived ? (
              <span className="text-muted-foreground text-xs" data-testid="suggestion-archived">
                {t.suggestions.archivedCard(
                  formatDate(sessionDateToDisplayDate(suggestion.window.openThrough)),
                )}
              </span>
            ) : (
              <DecisionBar
                originKind="suggestion"
                targetId={suggestion.id}
                allowedKinds={allowedDecisionKinds({ kind: "suggestion" })}
                defaultHorizon={suggestion.horizon}
                defaultInstrument={suggestion.underlying}
              />
            )}
          </>
        }
      />
    );
    // Framed in a list, so the list's own title never reads as part of the first card.
    return onPage ? (
      <Fragment key={suggestion.id}>{card}</Fragment>
    ) : (
      <div key={suggestion.id} className="border-border rounded-[var(--radius)] border p-3">
        {card}
      </div>
    );
  });
}
