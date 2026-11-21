// A client-safe entry point into `recipes` (ticket #380): `./index.ts` re-exports server
// components (`RecipePanel`) that pull in `next/headers`, which a client component can never
// import even transitively. `exitText` is a pure formatter with no server dependency, so a
// client component reaches it through this barrel instead of the main one.
export { exitText } from "./rule-text";
