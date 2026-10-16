interface AnthropicEnv {
  ANTHROPIC_API_KEY?: string;
  [key: string]: string | undefined;
}

// Never logged, never returned: the only thing this function does with the
// key is hand it to the SDK client.
export function readAnthropicApiKey(env: AnthropicEnv = process.env): string | undefined {
  const raw = env.ANTHROPIC_API_KEY;
  return raw === undefined || raw === "" ? undefined : raw;
}
