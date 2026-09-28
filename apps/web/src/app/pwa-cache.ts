import { NetworkOnly, type RuntimeCaching } from "serwist";

export const OFFLINE_FALLBACK_URL = "/offline.html";

// "Offline: cached shell only" (CLAUDE.md, docs/adr/0025): the precache holds
// the build output and public/, and nothing is cached at runtime. Pages, RSC
// payloads and /api/* carry the signed-in user's data and would outlive
// sign-out on the device (#43). Navigations go to the network and fall back
// to a static offline page.
export const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ request }) => request.mode === "navigate",
    handler: new NetworkOnly(),
  },
];
