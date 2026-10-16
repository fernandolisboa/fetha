// The client-safe entry point: only its Server Actions ("use server" in
// ./actions), so a client component can import this without pulling in
// PreferencesRepository, Drizzle or any other server-only module through
// the module's main index.
export {
  dismissAssetTourAction,
  dismissTourAction,
  setLayoutAction,
  setRailCollapsedAction,
  setThemeAction,
  type PreferencesActionResult,
} from "./actions";
