import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getSession } from "@/modules/auth";
import { getPreferences } from "@/modules/preferences";

import { themeFontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fetha",
  description: "Laboratório pessoal de trading e investimentos.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSession();
  const theme = user ? (await getPreferences()).theme : undefined;

  return (
    <html lang="pt-BR" data-theme={theme} className={`${themeFontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
