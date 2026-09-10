import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { PreferencesRepository, type Preferences } from "./preferences-repository";

// Cached per request: the root layout, the shell layout and a page inside it
// can each call this without issuing a second preferences query.
export const getPreferences = cache(async (): Promise<Preferences> => {
  const repository = await forCurrentUser(getDb(), PreferencesRepository);
  return repository.find();
});
