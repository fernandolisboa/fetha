import { formatBRL } from "@/lib/format/brl";
import { Panel } from "@/modules/shell/client";

import {
  discardedOutcome,
  type ResearchCalibration,
  type ResearchVerdictLine,
} from "../research-calibration";
import { t } from "../strings";

function Row({ line }: { line: ResearchVerdictLine }) {
  return (
    <tr
      className="border-line-soft border-b last:border-b-0"
      data-testid={`research-row-${line.verdict}`}
    >
      <td className="py-1.5 pr-3">{t.research.groups[line.verdict]}</td>
      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
        {line.scored}
        {line.unscorable > 0 && (
          <span className="text-muted-foreground block text-[11px]">
            {t.research.calibration.noData(line.unscorable)}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
        {t.research.calibration.held(line.held, line.claimed)}
      </td>
      <td
        className="py-1.5 text-right font-mono tabular-nums"
        style={{
          color:
            line.averagePnl === null
              ? undefined
              : line.averagePnl < 0
                ? "var(--down)"
                : line.averagePnl > 0
                  ? "var(--up)"
                  : undefined,
        }}
      >
        {line.averagePnl === null ? "—" : formatBRL(line.averagePnl)}
      </td>
    </tr>
  );
}

// docs/adr/0076: how the verdicts of the user's own researches aged at each idea's expiry, apart
// from their track record, the AI calibration and the shared suggestions' panel.
export function ResearchCalibrationPanel({ calibration }: { calibration: ResearchCalibration }) {
  const strings = t.research.calibration;
  const scored = calibration.reduce((sum, line) => sum + line.scored + line.unscorable, 0);
  const discarded = discardedOutcome(calibration);
  return (
    <Panel title={strings.title} subtitle={strings.subtitle}>
      {scored === 0 ? (
        <p className="text-muted-foreground text-[13px]" data-testid="research-calibration-empty">
          {strings.empty}
        </p>
      ) : (
        <>
          <table className="w-full text-left text-xs" data-testid="research-calibration">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-1.5 pr-3 font-normal">{strings.columns.verdict}</th>
                <th className="py-1.5 pr-3 text-right font-normal">{strings.columns.scored}</th>
                <th className="py-1.5 pr-3 text-right font-normal">{strings.columns.held}</th>
                <th className="py-1.5 text-right font-normal">{strings.columns.pnl}</th>
              </tr>
            </thead>
            <tbody>
              {calibration.map((line) => (
                <Row key={line.verdict} line={line} />
              ))}
            </tbody>
          </table>
          {discarded && (
            <p className="text-[13px] text-pretty" data-testid="research-discarded-sentence">
              {strings.discardedSentence(
                discarded.count,
                formatBRL(discarded.amount),
                discarded.sign,
              )}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
