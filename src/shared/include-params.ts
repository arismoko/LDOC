/**
 * Shared helpers for @include/@params arity validation.
 *
 * Used by both BIND (static validation) and EVALUATE (runtime belt-and-suspenders).
 * Pure functions — no context dependency.
 */

import type { Document, Directive } from "../types/cst.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import type { SourceLocation } from "../types/source-location.ts";
import { error as diagError, DiagnosticCode } from "../types/diagnostics.ts";

/**
 * Extract required parameter names from a document's @params directive.
 *
 * Returns the valid names array and any diagnostics from malformed @params.
 */
export function readParamsNames(
  cst: Document,
): { names: string[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  const paramsDirective = cst.children.find(
    (block): block is Directive => block.kind === "Directive" && block.name === "params",
  );

  if (!paramsDirective) {
    return { names: [], diagnostics };
  }

  const args = paramsDirective.args ?? {};
  const names = args.names;
  if (!Array.isArray(names)) {
    diagnostics.push(
      diagError(
        DiagnosticCode.PARSE_ERROR,
        "@params requires names: [\"name\", ...]",
        paramsDirective.loc,
      ),
    );
    return { names: [], diagnostics };
  }

  const rawNames = names as unknown[];
  const validNames = rawNames.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  if (validNames.length !== rawNames.length) {
    diagnostics.push(
      diagError(
        DiagnosticCode.PARSE_ERROR,
        "@params names must be an array of non-empty strings",
        paramsDirective.loc,
      ),
    );
    return { names: [], diagnostics };
  }

  return { names: validNames, diagnostics };
}

/**
 * Validate that provided include args satisfy required parameter names.
 *
 * Returns diagnostics for each missing required arg.
 */
export function validateIncludeParams(
  requiredNames: string[],
  providedArgs: Record<string, unknown>,
  includeLoc: SourceLocation,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const name of requiredNames) {
    if (!(name in providedArgs)) {
      diagnostics.push(
        diagError(
          DiagnosticCode.ARITY_MISMATCH,
          `Missing include arg '${name}' required by @params(names: [...])`,
          includeLoc,
        ),
      );
    }
  }
  return diagnostics;
}
