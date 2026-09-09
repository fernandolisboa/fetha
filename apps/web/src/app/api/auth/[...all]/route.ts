import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/modules/auth/auth";

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler((request: Request) =>
  getAuth().handler(request),
);
