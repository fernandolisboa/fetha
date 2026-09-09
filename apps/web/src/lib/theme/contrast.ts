function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// WCAG 2.x contrast ratio (relative luminance method), used against
// DESIGN.md's 4.5:1 (text) and 3:1 (chart/semantic) thresholds.
export function contrastRatio(foreground: string, background: string): number {
  const lf = relativeLuminance(hexToRgb(foreground));
  const lb = relativeLuminance(hexToRgb(background));
  const [lighter, darker] = lf > lb ? [lf, lb] : [lb, lf];
  return (lighter + 0.05) / (darker + 0.05);
}
