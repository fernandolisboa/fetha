import {
  factAt,
  outlookOf,
  verdictOf,
  type AnalysisInputs,
  type StoredAnalysisOutput,
} from "@fetha/contracts";

import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format/date-time";

import { t } from "../strings";

import { modelDisplayName } from "@/modules/ai-models/client";

export interface AnalysisPanelData {
  output: StoredAnalysisOutput;
  model: string;
  promptVersion: string;
  requestedAt: Date;
  inputs: AnalysisInputs;
}

function citedFactValue(inputs: AnalysisInputs, path: string): string | null {
  const fact = factAt(inputs.facts, path);
  return typeof fact === "string" ? fact : null;
}

const labels = t.analysis.panel;

// docs/adr/0058: the outlook in words, with the instrument and level read
// from the facts its paths name. `analysis@1` replies carry no outlook field
// and show no outlook section at all.
export function panelOutlookSentence(analysis: AnalysisPanelData): string | null {
  if (!("outlook" in analysis.output)) {
    return null;
  }
  const outlook = outlookOf(analysis.output);
  if (outlook === null) {
    return t.journal.analysis.outlookNone;
  }
  const sentence = t.analysis.outlook(
    citedFactValue(analysis.inputs, outlook.instrumentFact) ?? "",
    outlook.direction,
    citedFactValue(analysis.inputs, outlook.levelFact) ?? "",
    t.analysis.horizon[outlook.horizon],
  );
  return `${sentence} · ${t.analysis.likelihood[outlook.likelihood]}`;
}

// DESIGN.md's AnalysisPanel: thesis, counter-thesis, risks, invalidation,
// confidence, inputs cited, prompt version and model. The model's own
// prose is always rendered as plain text, never `dangerouslySetInnerHTML`.
export function AnalysisPanel({ analysis }: { analysis: AnalysisPanelData }) {
  const outlook = panelOutlookSentence(analysis);
  const verdict = verdictOf(analysis.output);
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      {verdict !== null ? (
        <section className="flex flex-col gap-2" data-testid="analysis-verdict">
          <h3 className="text-muted-foreground text-[11px] uppercase">{labels.verdict}</h3>
          <p className="text-[15px] font-medium">{t.analysis.verdict[verdict.decision]}</p>
          <p className="text-pretty whitespace-pre-wrap">{verdict.justification}</p>
        </section>
      ) : null}

      <section
        className={
          verdict !== null
            ? "border-line-soft flex flex-col gap-1 border-t pt-3"
            : "flex flex-col gap-1"
        }
      >
        <h3 className="text-muted-foreground text-[11px] uppercase">{labels.thesis}</h3>
        <p className="text-pretty whitespace-pre-wrap">{analysis.output.thesis}</p>
      </section>

      <section className="border-line-soft flex flex-col gap-1 border-t pt-3">
        <h3 className="text-muted-foreground text-[11px] uppercase">{labels.counterThesis}</h3>
        <p className="text-pretty whitespace-pre-wrap">{analysis.output.counterThesis}</p>
      </section>

      <section className="border-line-soft flex flex-col gap-1 border-t pt-3">
        <h3 className="text-muted-foreground text-[11px] uppercase">{labels.keyRisks}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {analysis.output.keyRisks.map((risk, index) => (
            <li key={index}>{risk}</li>
          ))}
        </ul>
      </section>

      <section className="border-line-soft grid grid-cols-2 gap-4 border-t pt-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground text-[11px] uppercase">{labels.maxLoss}</h3>
          <p className="text-pretty">{analysis.output.maxLoss}</p>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground text-[11px] uppercase">{labels.breakEvens}</h3>
          <p className="text-pretty">{analysis.output.breakEvens}</p>
        </div>
      </section>

      <section className="border-line-soft flex flex-col gap-1 border-t pt-3">
        <h3 className="text-muted-foreground text-[11px] uppercase">{labels.invalidation}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {analysis.output.invalidation.map((condition, index) => (
            <li key={index}>{condition}</li>
          ))}
        </ul>
      </section>

      <section className="border-line-soft flex flex-col gap-2 border-t pt-3">
        <h3 className="text-muted-foreground text-[11px] uppercase">{labels.confidence}</h3>
        <Badge variant="outline">
          {t.analysis.confidenceLevel[analysis.output.confidence.level]}
        </Badge>
        <p className="text-muted-foreground text-pretty">
          {analysis.output.confidence.justification}
        </p>
      </section>

      {outlook !== null ? (
        <section className="border-line-soft flex flex-col gap-1 border-t pt-3">
          <h3 className="text-muted-foreground text-[11px] uppercase">
            {t.journal.analysis.outlookLabel}
          </h3>
          <p className="text-pretty">{outlook}</p>
        </section>
      ) : null}

      <section className="border-line-soft flex flex-col gap-1 border-t pt-3">
        <h3 className="text-muted-foreground text-[11px] uppercase">{labels.inputsCited}</h3>
        <ul className="flex flex-col gap-1">
          {[...new Set(analysis.output.inputsCited)].map((path) => {
            const value = citedFactValue(analysis.inputs, path);
            return (
              <li key={path} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-muted-foreground font-mono">{path}</span>
                {value !== null && <span className="font-mono tabular-nums">{value}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-muted-foreground border-line-soft border-t pt-3 text-[12px]">
        {labels.metadata(
          formatDateTime(analysis.requestedAt),
          analysis.promptVersion,
          modelDisplayName(analysis.model),
        )}
      </p>

      <p className="text-muted-foreground text-[12px]">{labels.disclaimer}</p>
    </div>
  );
}
