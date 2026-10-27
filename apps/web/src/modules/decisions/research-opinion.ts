import type { SessionDate } from "@fetha/contracts";

import type { resolveAnalysisModelForCurrentUser } from "@/modules/ai-models";
import type { ResearchResult } from "@/modules/radar";

import { MONTHLY_ANALYSIS_CAP } from "./analyses-repository";
import { REQUEST_TIMEOUT_MS } from "./analysis-model";
import { selectIdeasToSend } from "./research-inputs";
import type { StoredResearch } from "./research-repository";
import type { RequestResearchInput, RequestResearchResult } from "./research-service";
import { researchViewOf, type ResearchView } from "./research-view";
import type { IdeaCard } from "@/modules/radar";

export type ResearchNotice =
  | { kind: "no_key" }
  | { kind: "key_unreadable" }
  | { kind: "cap_reached"; cap: number }
  | { kind: "rate_limited" }
  | { kind: "failed" };

export type OpinionOutcome =
  | { research: ResearchView; notice: null; stored: true }
  | { research: null; notice: ResearchNotice | null; stored: boolean };

type ModelChoice = Awaited<ReturnType<typeof resolveAnalysisModelForCurrentUser>>;

// The page's `maxDuration` (180 s, app/(shell)/page.tsx) less the model's own timeout and room to
// reserve, assemble the facts and store the answer: past this much time spent on the engine, the
// platform could kill a call that is already paid for (docs/adr/0076).
export const ACTION_MAX_DURATION_MS = 180_000;
export const STORAGE_HEADROOM_MS = 35_000;
export const LATEST_MODEL_START_MS =
  ACTION_MAX_DURATION_MS - REQUEST_TIMEOUT_MS - STORAGE_HEADROOM_MS;

export interface OpinionPorts {
  resolveModel: () => Promise<ModelChoice>;
  // Resolves to false when the account is past its per-minute floor.
  takeRequestToken: () => Promise<boolean>;
  request: (
    choice: Extract<ModelChoice, { status: "ok" }>,
    input: RequestResearchInput,
    mustStartBy: number,
  ) => Promise<RequestResearchResult>;
  readStored: (researchId: string) => Promise<StoredResearch | null>;
  newestReadSession: () => Promise<SessionDate | null>;
  toCard: (idea: ResearchResult["holding"][number]) => IdeaCard;
  clock: () => number;
  // Called with an error that did not stop the engine's view from being returned.
  onError: (error: unknown) => void;
}

// The model's opinion on the engine's research (docs/adr/0076). Nothing past the engine's result
// may take that result away: every way the opinion is missing, including an unexpected error, leaves
// the cards on screen with one notice.
export async function opinionOn(
  result: ResearchResult,
  startedAt: number,
  ports: OpinionPorts,
): Promise<OpinionOutcome> {
  const { sent, unsent } = selectIdeasToSend(result);
  if (sent.length === 0 || result.newestClose === null) {
    return { research: null, notice: null, stored: false };
  }
  const newestClose = result.newestClose;
  let stored = false;
  try {
    // The key is checked before the per-minute token is spent: a user with no key never calls.
    const choice = await ports.resolveModel();
    if (choice.status === "own_key_missing") {
      return { research: null, notice: { kind: "no_key" }, stored };
    }
    if (choice.status === "own_key_unreadable") {
      return { research: null, notice: { kind: "key_unreadable" }, stored };
    }
    if (!(await ports.takeRequestToken())) {
      return { research: null, notice: { kind: "rate_limited" }, stored };
    }
    const mustStartBy = startedAt + LATEST_MODEL_START_MS;
    if (ports.clock() > mustStartBy) {
      return { research: null, notice: { kind: "failed" }, stored };
    }

    const answered = await ports.request(
      choice,
      {
        newestClose,
        sessionsLooked: result.sessionsLooked,
        candidates: result.candidates,
        dropped: result.dropped,
        usingDefaultProfile: result.usingDefaultProfile,
        ideas: sent,
      },
      mustStartBy,
    );
    if (answered.status === "cap_reached") {
      return { research: null, notice: { kind: "cap_reached", cap: MONTHLY_ANALYSIS_CAP }, stored };
    }
    if (answered.status !== "accepted") {
      return { research: null, notice: { kind: "failed" }, stored };
    }
    stored = true;

    const research = await ports.readStored(answered.researchId);
    if (!research) return { research: null, notice: { kind: "failed" }, stored };
    return {
      research: researchViewOf({
        research,
        decisions: new Map(),
        newestReadSession: await ports.newestReadSession(),
        unsent: unsent.map(ports.toCard),
      }),
      notice: null,
      stored: true,
    };
  } catch (error) {
    ports.onError(error);
    return { research: null, notice: { kind: "failed" }, stored };
  }
}
