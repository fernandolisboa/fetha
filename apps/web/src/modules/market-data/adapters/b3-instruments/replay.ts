import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ParsedInstrumentsRegistry } from "./parser";
import { parseInstrumentsRegistry } from "./parser";

const RECORDING_NAME = /^(\d{4}-\d{2}-\d{2})\.csv$/;

// E2E only: replays registries recorded from arquivos.b3.com.br, one `<session>.csv` per session,
// instead of fetching the live one. A session without its own recording gets the newest one
// recorded before it, so a recent session re-reads series the suite already ingested.
export async function replayInstrumentsRegistry(
  directory: string,
  session: string,
): Promise<ParsedInstrumentsRegistry> {
  const recorded = (await readdir(directory))
    .map((name) => RECORDING_NAME.exec(name)?.[1])
    .filter((date): date is string => date !== undefined && date <= session)
    .sort();
  const date = recorded.at(-1);
  if (!date) {
    throw new Error(`no instruments registry recorded on or before ${session}`);
  }
  const content = await readFile(path.join(directory, `${date}.csv`), { encoding: "latin1" });
  return parseInstrumentsRegistry(content);
}
