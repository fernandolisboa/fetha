import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fetha",
    short_name: "Fetha",
    description: "Laboratório pessoal de trading e investimentos.",
    lang: "pt-BR",
    start_url: "/",
    display: "standalone",
    // Instrumento (the default theme): --bg and --surface (DESIGN.md).
    background_color: "#0f1115",
    theme_color: "#151922",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
