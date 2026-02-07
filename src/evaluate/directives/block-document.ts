/**
 * @document directive handler.
 * Parses document metadata and page layout configuration.
 */

import type { Directive } from "../../types/cst.ts";
import type { Block, PageLayout } from "../../types/document-ir.ts";
import type { ArgsObject } from "../../shared/args.ts";
import type { EvalContext, BlockDirectiveHandler } from "../handler.ts";
import {
  DiagnosticCode,
  warning as createWarning,
} from "../../types/diagnostics.ts";
import { parseLengthToTwips } from "../../shared/units.ts";
import type { SourceLocation } from "../../types/source-location.ts";

function tryParseTwips(value: string): number | undefined {
  try {
    return parseLengthToTwips(value);
  } catch {
    return undefined;
  }
}

function parseSingleMargin(value: unknown, fallback: number, ctx: EvalContext, loc: SourceLocation): number {
  if (typeof value === "string") {
    const twips = tryParseTwips(value);
    if (twips === undefined) {
      ctx.diagnostics.push(
        createWarning(
          DiagnosticCode.PARSE_ERROR,
          `Invalid margin value "${value}", using default`,
          loc,
        ),
      );
      return fallback;
    }
    return twips;
  }
  if (typeof value === "number") return value;
  ctx.diagnostics.push(
    createWarning(
      DiagnosticCode.PARSE_ERROR,
      `Margin value must be a string or number, got ${typeof value}`,
      loc,
    ),
  );
  return fallback;
}

/**
 * Parse margin shorthand string: "1in" (all), "1in 1.25in" (v h),
 * "1in 1in 1in 1.25in" (top right bottom left — CSS order).
 */
function parseMarginsString(
  raw: string,
  ctx: EvalContext,
  loc: Directive["loc"],
): PageLayout["margins"] {
  const parts = raw.trim().split(/\s+/);
  try {
    if (parts.length === 1) {
      const all = parseLengthToTwips(parts[0]!);
      return { top: all, bottom: all, left: all, right: all };
    }
    if (parts.length === 2) {
      const vertical = parseLengthToTwips(parts[0]!);
      const horizontal = parseLengthToTwips(parts[1]!);
      return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
    }
    if (parts.length === 4) {
      return {
        top: parseLengthToTwips(parts[0]!),
        right: parseLengthToTwips(parts[1]!),
        bottom: parseLengthToTwips(parts[2]!),
        left: parseLengthToTwips(parts[3]!),
      };
    }
    ctx.diagnostics.push(
      createWarning(DiagnosticCode.PARSE_ERROR, "margins string must have 1, 2, or 4 values", loc),
    );
    return undefined;
  } catch {
    ctx.diagnostics.push(
      createWarning(DiagnosticCode.PARSE_ERROR, `Invalid margin value in "${raw}"`, loc),
    );
    return undefined;
  }
}

/**
 * Parse page layout config from @document args.
 * Supports margins (string or object), pageSize, and orientation.
 */
function parseDocumentLayout(
  args: ArgsObject,
  ctx: EvalContext,
  loc: Directive["loc"],
): PageLayout | undefined {
  let hasLayout = false;
  const layout: PageLayout = {};

  // Parse margins — string shorthand or object
  if (args.margins !== undefined) {
    hasLayout = true;
    if (typeof args.margins === "string") {
      layout.margins = parseMarginsString(args.margins, ctx, loc);
    } else if (typeof args.margins === "object" && args.margins !== null) {
      const m = args.margins as Record<string, unknown>;
      const partial: Record<string, number> = {};
      if (m.top !== undefined) partial.top = parseSingleMargin(m.top, 1440, ctx, loc);
      if (m.bottom !== undefined) partial.bottom = parseSingleMargin(m.bottom, 1440, ctx, loc);
      if (m.left !== undefined) partial.left = parseSingleMargin(m.left, 1440, ctx, loc);
      if (m.right !== undefined) partial.right = parseSingleMargin(m.right, 1440, ctx, loc);
      if (Object.keys(partial).length > 0) {
        layout.margins = partial as PageLayout["margins"];
      }
    }
  }

  // Parse page size
  if (args.pageSize !== undefined && typeof args.pageSize === "object" && args.pageSize !== null) {
    hasLayout = true;
    const ps = args.pageSize as Record<string, unknown>;
    const width = typeof ps.width === "string" ? tryParseTwips(ps.width) : undefined;
    const height = typeof ps.height === "string" ? tryParseTwips(ps.height) : undefined;
    if (width !== undefined && height !== undefined) {
      layout.pageSize = { width, height };
    }
  }

  // Parse orientation
  if (args.orientation === "landscape" || args.orientation === "portrait") {
    hasLayout = true;
    layout.orientation = args.orientation;
  }

  return hasLayout ? layout : undefined;
}

export const handleDocument: BlockDirectiveHandler = async (node, ctx) => {
  const args = node.args ?? {};
  if (typeof args.title === "string") ctx.metadata.title = args.title;
  if (typeof args.author === "string") ctx.metadata.author = args.author;
  if (typeof args.date === "string") ctx.metadata.date = args.date;

  // Parse page layout config (Spec §6)
  const layout = parseDocumentLayout(args, ctx, node.loc);
  if (layout) {
    ctx.metadata.layout = layout;
  }

  // Parse numbering mode (Spec §11.2)
  const numbering = args.numbering;
  if (numbering && typeof numbering === "object") {
    const mode = (numbering as Record<string, unknown>).mode;
    if (typeof mode === "string") {
      ctx.metadata.custom.numberingMode = mode;
    }
  } else if (typeof numbering === "string") {
    // String shorthand: @document(numbering: "legal")
    ctx.metadata.custom.numberingMode = numbering;
  }

  for (const [key, value] of Object.entries(args)) {
    ctx.metadata.custom[key] = value;
  }
  return [];
};
