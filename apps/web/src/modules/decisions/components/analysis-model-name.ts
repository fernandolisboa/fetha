// docs/adr/0057's own two models: a friendly name for the metadata line,
// never the raw id (unless a future model isn't in this map yet).
const DISPLAY_NAMES: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
};

export function analysisModelDisplayName(model: string): string {
  return DISPLAY_NAMES[model] ?? model;
}
