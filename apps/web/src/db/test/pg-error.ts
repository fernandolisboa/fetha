export function postgresError(
  code: string,
  extra: { constraint?: string; message?: string } = {},
): Error & { code: string; severity: string; constraint?: string } {
  const { message = "db failure", ...fields } = extra;
  return Object.assign(new Error(message), { code, severity: "ERROR", ...fields });
}

export function drizzleQueryError(cause: unknown): Error {
  return new Error("Failed query: ...", { cause });
}
