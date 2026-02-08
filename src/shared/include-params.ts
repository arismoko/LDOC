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

export type IncludeParamTypeName = "string" | "number" | "boolean" | "object" | "array";

export interface IncludeParamTypeContract {
  type: IncludeParamTypeName;
  optional: boolean;
}

export interface IncludeParamsContract {
  names: string[];
  types: Record<string, IncludeParamTypeContract>;
  diagnostics: Diagnostic[];
}

const INCLUDE_PARAM_TYPE_PATTERN = /^(string|number|boolean|object|array)(\?)?$/;

/**
 * Extract @params include contract (names + optional types) from a document.
 */
export function readParamsContract(cst: Document): IncludeParamsContract {
  const diagnostics: Diagnostic[] = [];

  const paramsDirective = cst.children.find(
    (block): block is Directive => block.kind === "Directive" && block.name === "params",
  );

  if (!paramsDirective) {
    return { names: [], types: {}, diagnostics };
  }

  const args = paramsDirective.args ?? {};

  const hasNames = Object.prototype.hasOwnProperty.call(args, "names");
  const hasTypes = Object.prototype.hasOwnProperty.call(args, "types");
  if (!hasNames && !hasTypes) {
    diagnostics.push(
      diagError(
        DiagnosticCode.PARSE_ERROR,
        "@params requires names: [\"name\", ...] and/or types: { key: \"type\" }",
        paramsDirective.loc,
      ),
    );
    return { names: [], types: {}, diagnostics };
  }

  const validNames: string[] = [];
  if (hasNames) {
    const names = args.names;
    if (!Array.isArray(names)) {
      diagnostics.push(
        diagError(
          DiagnosticCode.PARSE_ERROR,
          "@params names must be an array of non-empty strings",
          paramsDirective.loc,
        ),
      );
    } else {
      const rawNames = names as unknown[];
      const parsedNames = rawNames.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      );
      if (parsedNames.length !== rawNames.length) {
        diagnostics.push(
          diagError(
            DiagnosticCode.PARSE_ERROR,
            "@params names must be an array of non-empty strings",
            paramsDirective.loc,
          ),
        );
      } else {
        validNames.push(...parsedNames);
      }
    }
  }

  const types: Record<string, IncludeParamTypeContract> = {};
  if (hasTypes) {
    const rawTypes = args.types;
    if (!rawTypes || typeof rawTypes !== "object" || Array.isArray(rawTypes)) {
      diagnostics.push(
        diagError(
          DiagnosticCode.MALFORMED_INCLUDE_PARAM_TYPE,
          "@params types must be an object: { name: \"string\", ... }",
          paramsDirective.loc,
        ),
      );
    } else {
      for (const [name, literal] of Object.entries(rawTypes as Record<string, unknown>)) {
        if (hasNames && !validNames.includes(name)) {
          diagnostics.push(
            diagError(
              DiagnosticCode.MALFORMED_INCLUDE_PARAM_TYPE,
              `@params types key '${name}' must also appear in names when names is provided`,
              paramsDirective.loc,
            ),
          );
          continue;
        }

        const parsed = parseIncludeParamTypeLiteral(literal);
        if (!parsed) {
          diagnostics.push(
            diagError(
              DiagnosticCode.MALFORMED_INCLUDE_PARAM_TYPE,
              `Invalid include param type for '${name}'. Expected one of: string, number, boolean, object, array, with optional '?' suffix`,
              paramsDirective.loc,
            ),
          );
          continue;
        }

        types[name] = parsed;
      }
    }
  }

  // Start with names that are NOT marked optional in types
  const requiredNames = validNames.filter((n) => {
    const t = types[n];
    return !t || !t.optional;
  });
  // Add any required type-only keys not already covered by names
  for (const [name, type] of Object.entries(types)) {
    if (type.optional) {
      continue;
    }
    if (!requiredNames.includes(name)) {
      requiredNames.push(name);
    }
  }

  return { names: requiredNames, types, diagnostics };
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
          `Missing include arg '${name}' required by @params contract`,
          includeLoc,
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * Validate include arg runtime/static types against @params(types: ...).
 */
export function validateIncludeParamTypes(
  typeContracts: Record<string, IncludeParamTypeContract>,
  providedArgs: Record<string, unknown>,
  includeLoc: SourceLocation,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [name, contract] of Object.entries(typeContracts)) {
    if (!(name in providedArgs)) {
      continue;
    }

    const value = providedArgs[name];
    if (isValueOfExpectedType(value, contract.type)) {
      continue;
    }

    diagnostics.push(
      diagError(
        DiagnosticCode.INCLUDE_PARAM_TYPE_MISMATCH,
        `Include arg '${name}' must be ${contract.type}; got ${describeType(value)}`,
        includeLoc,
      ),
    );
  }
  return diagnostics;
}

function parseIncludeParamTypeLiteral(value: unknown): IncludeParamTypeContract | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = INCLUDE_PARAM_TYPE_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  return {
    type: match[1] as IncludeParamTypeName,
    optional: Boolean(match[2]),
  };
}

function isValueOfExpectedType(value: unknown, expected: IncludeParamTypeName): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
  }
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * Coerce @include args value to a Record.
 */
export function toIncludeArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
