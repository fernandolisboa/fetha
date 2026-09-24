import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const LOCAL_ENV_FILE = new URL("../../.env.local", import.meta.url);

// Next.js and dotenv never override a variable the shell already exports, so
// a DATABASE_URL another project left in the shell would silently win over
// this app's own apps/web/.env.local (#49). Database scripts read the file
// with the opposite precedence: when it exists, its values win.
export function readLocalEnvFile(file = LOCAL_ENV_FILE) {
  if (!existsSync(file)) {
    return {};
  }
  return parseEnv(readFileSync(file, "utf8"));
}

export function withLocalEnvFile(env = process.env, file = LOCAL_ENV_FILE) {
  return { ...env, ...readLocalEnvFile(file) };
}
