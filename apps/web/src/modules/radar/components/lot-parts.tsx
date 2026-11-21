import type { ReactNode } from "react";

export function Figure({
  label,
  value,
  hint,
  token,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  token?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</dt>
      <dd
        className="font-mono text-[13px] tabular-nums"
        style={token ? { color: `var(${token})` } : undefined}
      >
        {value}
      </dd>
      {hint && <span className="text-faint text-[11px]">{hint}</span>}
    </div>
  );
}
