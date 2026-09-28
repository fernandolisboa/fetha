// A client-safe barrel: the shell module's default entry point
// (`@/modules/shell`) also re-exports `AppShell`, which pulls in the
// server-only account menu (`next/headers`). A "use client" component in
// another module needs `Panel` or `EmptyState` without dragging that whole
// graph into its bundle.
export { EmptyState } from "./components/empty-state";
export { Panel } from "./components/panel";
