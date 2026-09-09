"use server";

import { revalidatePath } from "next/cache";

import { themeSchema } from "@fetha/contracts";
import { getDb } from "@/db/client";

import { PreferencesRepository } from "./preferences-repository";

export async function setThemeAction(formData: FormData): Promise<void> {
  const theme = themeSchema.parse(formData.get("theme"));
  const repository = await PreferencesRepository.forCurrentUser(getDb());
  await repository.setTheme(theme);
  revalidatePath("/", "layout");
}

export async function setRailCollapsedAction(collapsed: boolean): Promise<void> {
  const repository = await PreferencesRepository.forCurrentUser(getDb());
  await repository.setRailCollapsed(collapsed);
  revalidatePath("/", "layout");
}
