import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

import { isObsoleteCache, OFFLINE_FALLBACK_URL, runtimeCaching } from "./pwa-cache";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [{ url: OFFLINE_FALLBACK_URL, matcher: ({ request }) => request.mode === "navigate" }],
  },
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter(isObsoleteCache).map((name) => caches.delete(name))),
      ),
  );
});

serwist.addEventListeners();
