import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  JetBrains_Mono,
  Source_Code_Pro,
  Source_Sans_3,
  Source_Serif_4,
} from "next/font/google";

// Every theme font loads once here (CLAUDE.md, stack) so switching
// `data-theme` never triggers a network request; the CSS variables they
// expose are wired to the design tokens in globals.css.
export const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const sourceSerif4 = Source_Serif_4({
  variable: "--font-source-serif-4",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const sourceSans3 = Source_Sans_3({
  variable: "--font-source-sans-3",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const themeFontVariables = [
  ibmPlexSans.variable,
  ibmPlexMono.variable,
  jetBrainsMono.variable,
  sourceSerif4.variable,
  sourceSans3.variable,
  sourceCodePro.variable,
].join(" ");
