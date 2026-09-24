import { routeToLocalNeonProxy } from "../../../scripts/lib/local-neon.mjs";

if (process.env.DATABASE_URL) {
  routeToLocalNeonProxy(process.env.DATABASE_URL);
}
