// The client-safe entry point: display-only, so a client component (like
// decisions' analysis panel and journal item) can pull in the Claude id ->
// display name mapping without pulling in Drizzle, `next/headers` or any
// other server-only module through the module's main index (#322 review
// B1). `AiModelSettingsPanel` and the Server Actions it calls are reached
// through `index.ts` by the server page that renders the panel instead:
// nothing client-side imports them through here.
export { modelDisplayName } from "./display-name";
