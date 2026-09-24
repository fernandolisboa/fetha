import { neonConfig } from "@neondatabase/serverless";

// CI runs the integration suite against a Postgres service container behind
// Neon's local HTTP/WebSocket proxy (docs/adr/0016), reached through
// db.localtest.me, pinned to the loopback address. Left alone, the Neon
// driver speaks TLS to <host>:443, which only a real Neon endpoint serves.
const LOCAL_NEON_HOST = "db.localtest.me";
const LOCAL_NEON_PROXY_PORT = 4444;

export function routeToLocalNeonProxy(databaseUrl) {
  const host = new URL(databaseUrl).hostname.toLowerCase().replace(/\.$/, "");
  if (host !== LOCAL_NEON_HOST) {
    return;
  }
  neonConfig.fetchEndpoint = (endpointHost) =>
    `http://${endpointHost}:${LOCAL_NEON_PROXY_PORT}/sql`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = (endpointHost) => `${endpointHost}:${LOCAL_NEON_PROXY_PORT}/v2`;
}
