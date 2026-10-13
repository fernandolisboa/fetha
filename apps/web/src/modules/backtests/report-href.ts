export const AUTO_RUN_PARAM = "executar";

export function reportHref(
  strategyId: string,
  runId: string,
  options: { autoRun?: boolean } = {},
): string {
  const path = `/estrategias/${strategyId}/backtests/${runId}`;
  return options.autoRun ? `${path}?${AUTO_RUN_PARAM}=1` : path;
}
