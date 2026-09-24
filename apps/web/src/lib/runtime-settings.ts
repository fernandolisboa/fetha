import { createClient, parseConnectionString } from "@vercel/global-config";

export interface RuntimeSettings {
  read(key: string): Promise<unknown>;
}

interface RuntimeSettingsEnv {
  GLOBAL_CONFIG?: string;
  [key: string]: string | undefined;
}

const READ_TIMEOUT_MS = 2_000;

const noStore: RuntimeSettings = {
  read: () => Promise.resolve(undefined),
};

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Global Config read timed out", { cause: "timeout" }));
    }, ms);
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}

export function createRuntimeSettings(env: RuntimeSettingsEnv = process.env): RuntimeSettings {
  const connectionString = env.GLOBAL_CONFIG;
  if (!connectionString) {
    return noStore;
  }
  if (!parseConnectionString(connectionString)) {
    // A malformed connection string must degrade to the environment variable
    // (sign-up only) instead of failing every auth endpoint, since this runs
    // inside buildAuthOptions for the single cached Better Auth instance.
    console.error("GLOBAL_CONFIG is not a valid Global Config connection string; ignoring it");
    return noStore;
  }
  // A stale value served on upstream errors would let a flip to "closed" go
  // unseen for up to a week; a rejected read falls back to the env var instead.
  const client = createClient(connectionString, { staleIfError: false });
  return {
    async read(key) {
      try {
        return await withTimeout(client.get(key), READ_TIMEOUT_MS);
      } catch (error) {
        console.error("Global Config read failed", { key, name: errorName(error) });
        return undefined;
      }
    },
  };
}
