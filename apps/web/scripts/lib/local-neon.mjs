import { neonConfig } from "@neondatabase/serverless";

// CI runs the integration suite against a Postgres service container behind
// Neon's local HTTP/WebSocket proxy (docs/adr/0016), reached through
// db.localtest.me, public DNS for the loopback address. Left alone, the Neon
// driver speaks TLS to <host>:443, which only a real Neon endpoint serves.
export const LOCAL_NEON_HOST = "db.localtest.me";
const LOCAL_NEON_PROXY_PORT = 4444;

export function routeToLocalNeonProxy(databaseUrl) {
  if (new URL(databaseUrl).hostname !== LOCAL_NEON_HOST) {
    return;
  }
  neonConfig.fetchEndpoint = (host) => `http://${host}:${LOCAL_NEON_PROXY_PORT}/sql`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = (host) => `${host}:${LOCAL_NEON_PROXY_PORT}/v2`;
}
