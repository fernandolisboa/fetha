import { z } from "zod";

// Zod probes `new Function` to decide whether to compile its parsers. The
// nonce CSP forbids eval (#125), and browsers report that probe as a
// violation even though Zod catches the throw.
z.config({ jitless: true });
