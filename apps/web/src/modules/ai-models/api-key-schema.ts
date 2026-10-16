import { z } from "zod";

// Anthropic's own key shape; the real check of whether the key works is a
// live Models API call, done by the action before the key is ever stored.
export const anthropicApiKeySchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/);
