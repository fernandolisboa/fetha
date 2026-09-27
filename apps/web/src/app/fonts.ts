import localFont from "next/font/local";

// Every theme font loads once here (CLAUDE.md, stack) so switching
// `data-theme` never triggers a network request; the CSS variables they
// expose are wired to the design tokens in globals.css. Vendored as static
// woff2 files (SIL OFL 1.1, see the OFL.txt next to each family) instead of
// `next/font/google` because `next build` fetching Google Fonts is flaky in
// CI (issue #158).
export const ibmPlexSans = localFont({
  variable: "--font-ibm-plex-sans",
  src: [
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
});

export const ibmPlexMono = localFont({
  variable: "--font-ibm-plex-mono",
  src: [
    {
      path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  display: "swap",
});

export const jetBrainsMono = localFont({
  variable: "--font-jetbrains-mono",
  src: [
    {
      path: "./fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/jetbrains-mono/jetbrains-mono-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
});

export const sourceSerif4 = localFont({
  variable: "--font-source-serif-4",
  src: [
    {
      path: "./fonts/source-serif-4/source-serif-4-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/source-serif-4/source-serif-4-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const sourceSans3 = localFont({
  variable: "--font-source-sans-3",
  src: [
    {
      path: "./fonts/source-sans-3/source-sans-3-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/source-sans-3/source-sans-3-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/source-sans-3/source-sans-3-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
});

export const sourceCodePro = localFont({
  variable: "--font-source-code-pro",
  src: [
    {
      path: "./fonts/source-code-pro/source-code-pro-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/source-code-pro/source-code-pro-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  display: "swap",
});

export const themeFontVariables = [
  ibmPlexSans.variable,
  ibmPlexMono.variable,
  jetBrainsMono.variable,
  sourceSerif4.variable,
  sourceSans3.variable,
  sourceCodePro.variable,
].join(" ");
