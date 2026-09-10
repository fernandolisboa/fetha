// `structuredClone` is a JS-engine global (Node 17+, every evergreen browser, Deno), not a
// Node-specific API — using it keeps the engine platform-agnostic (ADR-0013) — but `lib: ["ES2022"]`
// predates its spec, and pulling in `lib: ["dom"]` for one function would drag in browser globals
// the engine must never assume. This is the narrow ambient declaration instead.
declare function structuredClone<T>(value: T): T;
