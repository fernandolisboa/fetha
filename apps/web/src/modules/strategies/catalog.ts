import { catalogSchema, type CatalogEntry } from "@fetha/contracts";

import catalogJson from "./catalog.json";

// docs/adr/0053: the one catalog file the seed script writes to
// `structures` and the editor reads its defaults from.
export const catalog: readonly CatalogEntry[] = catalogSchema.parse(catalogJson);

export function catalogDefaults(structureId: string): CatalogEntry["defaults"] | null {
  return catalog.find((entry) => entry.structure.id === structureId)?.defaults ?? null;
}
