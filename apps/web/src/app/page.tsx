import { centavosSchema } from "@fetha/contracts";
import { Button } from "@/components/ui/button";
import { registrationMode } from "@/lib/env";
import { formatBRL } from "@/lib/format/brl";

const sampleCentavos = centavosSchema.parse(123456);

export default function Home() {
  const mode = registrationMode();
  return (
    <main className="bg-background text-foreground flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Fetha</h1>
      <p className="text-muted-foreground max-w-md">
        Laboratório pessoal de trading e investimentos.
      </p>
      <Button>{formatBRL(sampleCentavos)}</Button>
      <p className="text-muted-foreground text-xs">Cadastro: {mode}</p>
    </main>
  );
}
