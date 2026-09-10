"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db/client";
import { forCurrentUser, UnauthenticatedError } from "@/modules/auth";

import { PreferencesRepository } from "./preferences-repository";
import { themeSchema } from "./theme";

export type PreferencesActionResult = { status: "ok" } | { status: "error" };

export async function setThemeAction(formData: FormData): Promise<PreferencesActionResult> {
  const parsed = themeSchema.safeParse(formData.get("theme"));
  if (!parsed.success) {
    return { status: "error" };
  }

  try {
    const repository = await forCurrentUser(getDb(), PreferencesRepository);
    await repository.setTheme(parsed.data);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }

  revalidatePath("/", "layout");
  return { status: "ok" };
}

export async function setRailCollapsedAction(collapsed: boolean): Promise<PreferencesActionResult> {
  const parsed = z.boolean().safeParse(collapsed);
  if (!parsed.success) {
    return { status: "error" };
  }

  try {
    const repository = await forCurrentUser(getDb(), PreferencesRepository);
    await repository.setRailCollapsed(parsed.data);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }

  return { status: "ok" };
}
