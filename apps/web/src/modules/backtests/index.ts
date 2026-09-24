// Ten identifiers, the ones a consumer outside this module actually
// reaches for (route handlers and pages under app/): server pieces only.
// Client components live in ./client, kept off this barrel so a "use
// client" boundary never pulls the repository (and its `next/headers`
// chain) into a client bundle.
export {
  BacktestRunAlreadyCompleteError,
  BacktestRunClaimError,
  BacktestRunNotFoundError,
} from "./backtest-run-repository";
export { runBacktestChunk } from "./run-chunk";
export { DEFAULT_COST_MODEL } from "./default-config";
export { getMyBacktestRun, getMyBacktestRunsForStrategy } from "./queries";
export { ReportPanel } from "./components/report-panel";
export { runErrorMessage, isResumableRunError, t } from "./strings";
