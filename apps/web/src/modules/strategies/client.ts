// The client-safe entry point: only the Server Actions ("use server" in
// ./actions), so a client component can import this without pulling in the
// repositories, Drizzle or any other server-only module through the
// module's main index.
export {
  addStrategyVersionAction,
  copySharedStrategyAction,
  createStrategyAction,
  setStrategyVisibilityAction,
  type StrategyActionResult,
} from "./actions";
