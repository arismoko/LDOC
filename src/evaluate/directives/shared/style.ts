/**
 * Shared style utilities used by both block and inline @style handlers.
 */

import type { ArgsObject } from "../../../shared/args.ts";
import type { InlineStyleProps, StyleRef } from "../../../types/document-ir.ts";
import type { SourceLocation } from "../../../types/source-location.ts";
import type { EvalContext } from "../../handler.ts";
import {
  DiagnosticCode,
  warning as createWarning,
} from "../../../types/diagnostics.ts";

export function inlineStyleFromRunChannel(value: unknown): InlineStyleProps {
  if (!value || typeof value !== "object") {
    return {};
  }

  const run = value as Record<string, unknown>;
  const style: InlineStyleProps = {};

  if (typeof run.bold === "boolean") style.bold = run.bold;
  if (typeof run.italic === "boolean") style.italic = run.italic;
  if (typeof run.underline === "boolean") style.underline = run.underline;
  if (typeof run.strikethrough === "boolean") style.strikethrough = run.strikethrough;
  if (typeof run.color === "string") style.color = run.color;
  if (typeof run.fontFamily === "string") style.fontFamily = run.fontFamily;
  if (typeof run.size === "number") style.fontSize = run.size;
  if (typeof run.fontSize === "number") style.fontSize = run.fontSize;

  return style;
}

export function paragraphStyleRefFromArgs(args: ArgsObject): StyleRef | undefined {
  const ref = typeof args.ref === "string" ? args.ref : undefined;
  const p = args.p;
  const r = args.r;

  const styleRef: StyleRef = {};
  if (ref) {
    styleRef.name = ref;
  }

  if (p && typeof p === "object") {
    const pObj = p as Record<string, unknown>;
    if (!styleRef.name && typeof pObj.use === "string") {
      styleRef.name = pObj.use;
    }
  }

  const inline = inlineStyleFromRunChannel(r);
  if (Object.keys(inline).length > 0) {
    styleRef.inline = inline;
  }

  if (!styleRef.name && !styleRef.inline) {
    return undefined;
  }

  return styleRef;
}

/**
 * Resolve @style(ref: ...) from @def bindings (Spec §10.4).
 * Returns merged r/p channels and whether a def was found.
 */
export function resolveStyleRef(
  args: ArgsObject,
  ctx: EvalContext,
  loc: SourceLocation,
): { runChannel: unknown; pChannel: unknown; refResolved: boolean } {
  let runChannel: unknown = args.r;
  let pChannel: unknown = args.p;
  let refResolved = false;

  if (typeof args.ref === "string") {
    const def = ctx.defs[args.ref];
    if (def && typeof def === "object") {
      refResolved = true;
      const defObj = def as Record<string, unknown>;
      // Merge r channel: def provides the base, call-site overrides win
      if (defObj.r && typeof defObj.r === "object" && runChannel && typeof runChannel === "object") {
        runChannel = { ...(defObj.r as Record<string, unknown>), ...(runChannel as Record<string, unknown>) };
      } else {
        runChannel = defObj.r ?? runChannel;
      }
      // Inherit p channel from def if not overridden at call site
      if (defObj.p && !pChannel) {
        pChannel = defObj.p;
      }
    } else if (def === undefined) {
      ctx.diagnostics.push(
        createWarning(DiagnosticCode.PARSE_ERROR, `@style ref "${args.ref}" not found in @def bindings`, loc),
      );
    }
  }

  return { runChannel, pChannel, refResolved };
}
