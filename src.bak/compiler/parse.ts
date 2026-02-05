import {
  parseLengthToTwip as sharedParseLengthToTwip,
  TWIPS_PER_LINE_UNIT,
} from "../shared/units";

// Re-export for existing consumers (strict mode)
export function parseLengthToTwip(raw: string, line?: number): number {
  return sharedParseLengthToTwip(raw, { line, lenient: false });
}

/**
 * Lenient length parser for compiler - allows values without units (defaults to inches).
 */
export function parseLengthToTwipCompiler(value: string | number): number {
  return sharedParseLengthToTwip(value, { lenient: true });
}

export { TWIPS_PER_LINE_UNIT };

export function parseMargins(
  args: string,
  parseLength: (raw: string) => number,
): { top: number; right: number; bottom: number; left: number; header?: number; footer?: number } {
  const parts = (args || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("@margins requires values, e.g. @margins 1in or @margins 1in 1.25in 1in 1.25in");
  }

  const kv: Record<string, number> = {};
  const vals: number[] = [];
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq !== -1) {
      const k = p.slice(0, eq).toLowerCase();
      const v = p.slice(eq + 1);
      kv[k] = parseLength(v);
    } else {
      vals.push(parseLength(p));
    }
  }

  let top: number, right: number, bottom: number, left: number;
  if (vals.length === 1) {
    top = right = bottom = left = vals[0]!;
  } else if (vals.length === 2) {
    top = bottom = vals[0]!;
    left = right = vals[1]!;
  } else if (vals.length === 3) {
    top = vals[0]!;
    left = right = vals[1]!;
    bottom = vals[2]!;
  } else if (vals.length === 4) {
    [top, right, bottom, left] = vals as [number, number, number, number];
  } else if (vals.length === 0) {
    // allow only key=value forms
    top = right = bottom = left = parseLength("1in");
  } else {
    throw new Error("@margins supports 1-4 positional values (CSS-like), plus optional header=/footer=");
  }

  const out: any = { top, right, bottom, left };
  if (kv.header !== undefined) out.header = kv.header;
  if (kv.footer !== undefined) out.footer = kv.footer;
  return out;
}

export function parseSpacing(
  args: string,
  parseLength: (raw: string) => number,
): { before?: number; after?: number; line?: number } {
  const raw = (args || "").trim();
  if (!raw) throw new Error("@spacing requires args, e.g. @spacing 1.5 or @spacing before=6pt after=6pt line=1.5");

  const parts = raw.split(/\s+/).filter(Boolean);
  const out: any = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) {
      // line multiplier
      const mult = parseFloat(p);
      if (!Number.isFinite(mult) || mult <= 0) throw new Error(`Invalid line spacing: ${p}`);
      out.line = Math.round(mult * TWIPS_PER_LINE_UNIT);
      continue;
    }
    const k = p.slice(0, eq).toLowerCase();
    const v = p.slice(eq + 1);
    if (k === "line") {
      const mult = parseFloat(v);
      if (!Number.isFinite(mult) || mult <= 0) throw new Error(`Invalid line spacing: ${v}`);
      out.line = Math.round(mult * TWIPS_PER_LINE_UNIT);
    } else if (k === "before") {
      out.before = parseLength(v);
    } else if (k === "after") {
      out.after = parseLength(v);
    } else {
      throw new Error(`Unknown @spacing key: ${k}`);
    }
  }
  return out;
}
