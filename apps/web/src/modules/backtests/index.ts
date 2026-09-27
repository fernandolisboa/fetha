// The identifiers a consumer outside this module actually
// reaches for (route handlers and pages under app/): server pieces only.
// Client components live in ./client, kept off this barrel so a "use
// client" boundary never pulls the repository (and its `next/headers`
// chain) into a client bundle.
export {
  ActiveBacktestRunLimitError,
  BacktestRunAlreadyCompleteError,
  BacktestRunClaimError,
  BacktestRunNotFoundError,
  DISCARDED_RUN_ERROR,
} from "./backtest-run-repository";
export { runBacktestChunk } from "./run-chunk";
export { DEFAULT_COST_MODEL } from "./default-config";
export {
  getMyActiveBacktestRuns,
  getMyBacktestRun,
  getMyBacktestRunsForStrategy,
  getMyComparison,
} from "./queries";
export { compareHref, comparedRunIds, MAX_COMPARED_RUNS, requestedRunIds } from "./comparison";
export { ComparisonView } from "./components/comparison-view";
export { CompareRunsPicker } from "./components/compare-runs-picker";
export { ReportPanel } from "./components/report-panel";
export { IN_PROGRESS_RUNS_HREF, runErrorMessage, isResumableRunError, t } from "./strings";
export { BacktestsDataExport } from "./data-export";
