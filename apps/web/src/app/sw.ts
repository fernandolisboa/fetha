import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

import {
  isObsoleteCache,
  OBSOLETE_EXPIRATION_DB,
  OFFLINE_FALLBACK_URL,
  runtimeCaching,
} from "./pwa-cache";

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

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess =
      request.onerror =
      request.onblocked =
        () => {
          resolve();
        };
  });
}

async function purgeObsoleteStorage(): Promise<void> {
  const names = await caches.keys();
  await Promise.all([
    ...names.filter(isObsoleteCache).map((name) => caches.delete(name)),
    deleteDatabase(OBSOLETE_EXPIRATION_DB),
  ]);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(purgeObsoleteStorage());
});

// skipWaiting activates this worker without waiting for the previous one's
// pending cache writes, which can recreate a cache the purge just deleted.
// Purging again on the first request after each start catches them.
let purgedSinceStart = false;
self.addEventListener("fetch", (event) => {
  if (!purgedSinceStart) {
    purgedSinceStart = true;
    event.waitUntil(purgeObsoleteStorage());
  }
});

serwist.addEventListeners();
