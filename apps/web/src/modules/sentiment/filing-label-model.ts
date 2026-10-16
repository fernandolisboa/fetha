import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { FilingLabelInputs } from "@fetha/contracts";
import { filingLabelFamily, filingLabelPrompt } from "@fetha/prompts";

import { withPinnedFallback } from "@/modules/ai-models";

export interface FilingLabelUsage {
  inputTokens: number;
  outputTokens: number;
}

export type FilingLabelReply =
  | { kind: "parsed"; output: unknown; model: string; usage: FilingLabelUsage }
  | { kind: "refusal"; model: string; usage: FilingLabelUsage }
  | { kind: "incomplete"; model: string; usage: FilingLabelUsage }
  // The API refused the request itself (a document it cannot read): retrying
  // the same bytes cannot succeed.
  | { kind: "bad_request" }
  | { kind: "api_error" };

export interface FilingLabelClient {
  label(request: { pdf: Uint8Array; inputs: FilingLabelInputs }): Promise<FilingLabelReply>;
}

const MAX_OUTPUT_TOKENS = 2000;
const REQUEST_TIMEOUT_MS = 60_000;
const outputFormat = zodOutputFormat(filingLabelPrompt.outputSchema);
const END_TURN_STOP_REASONS = new Set(["end_turn", "stop_sequence"]);

// Read by hand rather than through `parse()`, which throws before the stop
// reason can be read: a reply that came back unusable was still paid for and
// ends as a stored rejection, not a retry (docs/adr/0065).
export function replyFromMessage(message: Anthropic.Message): FilingLabelReply {
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  if (message.stop_reason === "refusal") {
    return { kind: "refusal", model: message.model, usage };
  }
  if (message.stop_reason === null || !END_TURN_STOP_REASONS.has(message.stop_reason)) {
    return { kind: "incomplete", model: message.model, usage };
  }
  const text = message.content
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

function errorReplyFrom(error: unknown): FilingLabelReply {
  if (error instanceof Anthropic.BadRequestError) {
    return { kind: "bad_request" };
  }
  if (error instanceof Anthropic.APIError) {
    return { kind: "api_error" };
  }
  throw error;
}

// The document is untrusted text (docs/adr/0065): the request carries no
// tools, and the reply is only ever parsed against the label contract. The
// model is resolved once per run by the caller (#322 review A4), not here,
// so every filing in the run shares one listing instead of each one
// re-resolving it; `onRejected` is the caller's own closure over that
// listing's key, built in `run-sentiment-job.ts`.
export function createAnthropicFilingLabelClient(
  apiKey: string,
  model: string,
  onRejected?: (modelId: string) => void,
): FilingLabelClient {
  const anthropic = new Anthropic({ apiKey });

  async function attempt(
    model: string,
    pdf: Uint8Array,
    inputs: FilingLabelInputs,
  ): Promise<FilingLabelReply> {
    const message = await anthropic.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: filingLabelPrompt.system,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: Buffer.from(pdf).toString("base64"),
                },
              },
              { type: "text", text: filingLabelPrompt.render(inputs) },
            ],
          },
        ],
        output_config: {
          effort: "low",
          format: { type: outputFormat.type, schema: outputFormat.schema },
        },
      },
      { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 },
    );
    return replyFromMessage(message);
  }

  return {
    async label({ pdf, inputs }): Promise<FilingLabelReply> {
      try {
        // Same one retry on the family's pinned floor as the analysis
        // client (docs/adr/0068): a bad PDF still ends `bad_request` after
        // it, since the pinned model refuses it for the same reason.
        return await withPinnedFallback(
          filingLabelFamily,
          model,
          (m) => attempt(m, pdf, inputs),
          onRejected,
        );
      } catch (error) {
        return errorReplyFrom(error);
      }
    },
  };
}
