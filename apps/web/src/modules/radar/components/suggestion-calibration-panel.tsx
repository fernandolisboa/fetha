import { formatBRL } from "@/lib/format/brl";
import { Panel } from "@/modules/shell";

import type { CalibrationLine } from "../calibration";
import { getSuggestionCalibration } from "../queries";
import { t } from "../strings";

function Row({ line, label }: { line: CalibrationLine; label: string }) {
  return (
    <tr className="border-line-soft border-b last:border-b-0">
      <td className="py-1.5 pr-3">{label}</td>
      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{line.scored}</td>
      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
        {t.calibration.held(line.held, line.claimed)}
      </td>
      <td
        className="py-1.5 text-right font-mono tabular-nums"
        style={{ color: line.pnl < 0 ? "var(--down)" : line.pnl > 0 ? "var(--up)" : undefined }}
      >
        {formatBRL(line.pnl)}
      </td>
    </tr>
  );
}

// docs/adr/0067: how Fetha's own suggestions did at their horizon, beside the user's track record.
export async function SuggestionCalibrationPanel() {
  const calibration = await getSuggestionCalibration();
  return (
    <Panel title={t.calibration.title} subtitle={t.calibration.subtitle}>
      {calibration.overall.scored === 0 ? (
        <p className="text-muted-foreground text-[13px]" data-testid="suggestion-calibration-empty">
          {t.calibration.empty}
        </p>
      ) : (
        <table className="w-full text-left text-xs" data-testid="suggestion-calibration">
          <thead>
            <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
              <th className="py-1.5 pr-3 font-normal">{t.calibration.columns.recipe}</th>
              <th className="py-1.5 pr-3 text-right font-normal">{t.calibration.columns.scored}</th>
              <th className="py-1.5 pr-3 text-right font-normal">{t.calibration.columns.held}</th>
              <th className="py-1.5 text-right font-normal">{t.calibration.columns.pnl}</th>
            </tr>
          </thead>
          <tbody>
            <Row line={calibration.overall} label={t.calibration.all} />
            {calibration.byRecipe.map((line) => (
              <Row key={line.recipeId} line={line} label={line.recipeName ?? ""} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
