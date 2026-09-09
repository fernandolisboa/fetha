export interface PoolLike {
  on(event: "error", listener: (error: unknown) => void): unknown;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function attachPoolErrorLogger(pool: PoolLike): void {
  pool.on("error", (error) => {
    console.error("Neon pool error", { name: errorName(error), code: errorCode(error) });
  });
}
