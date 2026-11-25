import Link from "next/link";

import { t } from "../strings";

// The one "Aprender: <nome>" contextual link (ADR-0081 addendum), rendered from a plain `href`
// resolved server-side by the caller (`lessonHrefForStructure`, never called from here): this
// component itself carries no DB, auth or lesson content import, so it is safe from a "use
// client" ancestor, unlike `@/modules/learning`'s main entry point.
export function StructureLessonLink({ href, name }: { href: string | null; name: string }) {
  if (!href) return null;
  return (
    <Link
      href={href}
      className="text-muted-foreground w-fit text-[11px] underline-offset-4 hover:underline"
    >
      {t.learnStructureLink(name)}
    </Link>
  );
}
