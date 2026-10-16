import Link from "next/link";
import type { Centavos } from "@fetha/contracts";

import { formatBRL } from "@/lib/format/brl";

import { t } from "../strings";

export function DeclaredCapitalValue({ declaredCapital }: { declaredCapital: Centavos | null }) {
  if (declaredCapital === null) {
    return (
      <Link href="/configuracoes/risco" className="text-primary font-mono hover:underline">
        {t.rail.capitalNotDeclared}
      </Link>
    );
  }
  return (
    <span className="text-foreground font-mono tabular-nums">{formatBRL(declaredCapital)}</span>
  );
}
