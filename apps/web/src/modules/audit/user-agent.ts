export interface DeviceSummary {
  browser: string | null;
  os: string | null;
}

// Order matters: Edge and Opera also send "Chrome/", Chrome also sends
// "Safari/", and Android also sends "Linux".
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad/, "iOS"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

function firstMatch(value: string, table: ReadonlyArray<readonly [RegExp, string]>): string | null {
  return table.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

export function describeUserAgent(userAgent: string | null): DeviceSummary {
  if (!userAgent) {
    return { browser: null, os: null };
  }
  return { browser: firstMatch(userAgent, BROWSERS), os: firstMatch(userAgent, SYSTEMS) };
}
