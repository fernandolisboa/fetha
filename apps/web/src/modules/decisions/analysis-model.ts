import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { analysisPrompt } from "@fetha/prompts";
import type { ModelFamily } from "@fetha/contracts";

import { withPinnedFallback } from "@/modules/ai-models";

export interface AnalysisModelRequest {
  // The id the resolver picked (docs/adr/0068); may be newer than the
  // family's pinned floor.
  model: string;
  family: ModelFamily;
  system: string;
  user: string;
  // Called with `model` once a pinned-fallback retry for it succeeds
  // (#322 review A2/A3): the resolver's own closure, so this module never
  // holds the plaintext listing key the catalog is cached under.
  onRejected?: (modelId: string) => void;
}

export type AnalysisModelReply =
  | { kind: "parsed"; output: unknown; model: string; usage: AnalysisUsage }
  | { kind: "refusal"; model: string; usage: AnalysisUsage }
  | { kind: "incomplete"; stopReason: string; model: string; usage: AnalysisUsage }
  | { kind: "api_error"; status: number | null };

export interface AnalysisUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AnalysisModelClient {
  analyze(request: AnalysisModelRequest): Promise<AnalysisModelReply>;
}

const MAX_OUTPUT_TOKENS = 8000;
// The pages that host the action run with `maxDuration = 120` (ADR-0057):
// one attempt of at most 100s leaves time to store the result, so a slow
// call ends as `api_error` instead of the platform killing the function.
const REQUEST_TIMEOUT_MS = 100_000;
const outputFormat = betaZodOutputFormat(analysisPrompt.outputSchema);
const END_TURN_STOP_REASONS = new Set(["end_turn", "stop_sequence"]);

// Reads the reply by hand instead of through the SDK's `parse()`, which
// throws on a reply that misses the schema before `stop_reason` can be
// read: a reply that came back but is unusable (refusal, truncation, any
// other non-`end_turn`/`stop_sequence` stop reason, or a reply that misses
// the schema) must stay `rejected` (counted, the call was paid); only no
// reply at all (`api_error`) stays `failed` (docs/adr/0057). Only the text
// after the last fallback block is the answering model's own.
export function replyFromMessage(message: BetaMessage): AnalysisModelReply {
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  if (message.stop_reason === "refusal") {
    return { kind: "refusal", model: message.model, usage };
  }
  if (message.stop_reason === null || !END_TURN_STOP_REASONS.has(message.stop_reason)) {
    return {
      kind: "incomplete",
      stopReason: message.stop_reason ?? "unknown",
      model: message.model,
      usage,
    };
  }
  const lastFallback = message.content.findLastIndex((block) => block.type === "fallback");
  const text = message.content
    .slice(lastFallback + 1)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  return { kind: "parsed", output: parseJson(text), model: message.model, usage };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function apiErrorFrom(error: unknown): AnalysisModelReply {
  if (error instanceof Anthropic.APIError) {
    const status: unknown = error.status;
    return { kind: "api_error", status: typeof status === "number" ? status : null };
  }
  throw error;
}

// The one real I/O boundary in this module (CLAUDE.md principle 7): the
// decisions module depends on this interface, never on the SDK directly,
// so the service's own tests use a fake instead of a live key.
export function createAnthropicAnalysisClient(apiKey: string): AnalysisModelClient {
  const anthropic = new Anthropic({ apiKey });

  async function attempt(
    model: string,
    family: ModelFamily,
    system: string,
    user: string,
  ): Promise<AnalysisModelReply> {
    // Haiku 5.5 has no server-side fallback (docs/adr/0068): the beta and
    // `fallbacks` are spread in only for the other two families, since
    // sending them for Haiku would be rejected by the API.
    const message = await anthropic.beta.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        thinking: { type: "adaptive" },
        output_config: {
          effort: "medium",
          format: { type: outputFormat.type, schema: outputFormat.schema },
        },
        ...(family === "haiku"
          ? {}
          : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
      },
      { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 },
    );
    return replyFromMessage(message);
  }

  return {
    async analyze({ model, family, system, user, onRejected }): Promise<AnalysisModelReply> {
      try {
        return await withPinnedFallback(
          family,
          model,
          (m) => attempt(m, family, system, user),
          onRejected,
        );
      } catch (error) {
        return apiErrorFrom(error);
      }
    },
  };
}
