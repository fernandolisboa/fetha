import type { Ticker } from "@fetha/contracts";

import { Panel } from "@/modules/shell";

import { t } from "../strings";
import { PlanViewQuestion } from "./plan-view-question";

// The asset page's entry point into a plan (ticket #379): one question, straight to the plan
// screen; no backtest, no recipe picker, just the ready-to-review operation.
export function PlanPanel({ ticker }: { ticker: Ticker }) {
  return (
    <Panel title={t.panel.title}>
      <PlanViewQuestion ticker={ticker} />
    </Panel>
  );
}
