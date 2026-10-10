import type { AnalysisFact, AnalysisFacts } from "@fetha/contracts";

function isFactList(fact: AnalysisFact): fact is readonly AnalysisFact[] {
  return Array.isArray(fact);
}

// Mirrors `hasFactAt` in `@fetha/contracts` (the citation check already
// proved every cited path resolves for an accepted analysis), but returns
// the fact itself so the panel can show the value a path resolves to.
export function resolveFactAtPath(facts: AnalysisFacts, path: string): AnalysisFact | undefined {
  let node: AnalysisFact | undefined = facts;
  for (const segment of path.split(".")) {
    if (node === null || node === undefined || typeof node === "string") {
      return undefined;
    }
    if (isFactList(node)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
      node = node[Number(segment)];
    } else {
      node = Object.hasOwn(node, segment) ? node[segment] : undefined;
    }
  }
  return node;
}
