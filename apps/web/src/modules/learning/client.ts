// The client-safe entry point: a "use client" component anywhere else may import only from
// here, never from `./index` (ADR-0081 addendum, review round 1 #1) — that barrel pulls in
// Drizzle, auth and every lesson's own quiz answer key.
export { StructureLessonLink } from "./components/structure-lesson-link";
