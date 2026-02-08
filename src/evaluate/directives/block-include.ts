/**
 * @include directive handler.
 */

import type * as CST from "../../types/cst.ts";
import type { Directive } from "../../types/cst.ts";
import type { Block } from "../../types/document-ir.ts";
import type { Diagnostic } from "../../types/diagnostics.ts";
import type { SourceLocation } from "../../types/source-location.ts";
import type { BlockDirectiveHandler, EvalContext } from "../handler.ts";
import {
  DiagnosticCode,
  error as createError,
} from "../../types/diagnostics.ts";
import { defaultIncludeRoot, resolveIncludeFilePath } from "../../shared/include-path.ts";
import {
  readParamsContract,
  validateIncludeParams,
  validateIncludeParamTypes,
} from "../../shared/include-params.ts";
import { parseSource } from "../../parse/index.ts";
import { bindSync } from "../../bind/index.ts";

function withLocationSource(location: SourceLocation, sourcePath: string): SourceLocation {
  if (location.source) {
    return location;
  }

  return {
    ...location,
    source: sourcePath,
  };
}

function withDiagnosticSource(diagnostic: Diagnostic, sourcePath: string): Diagnostic {
  return {
    ...diagnostic,
    location: withLocationSource(diagnostic.location, sourcePath),
  };
}

function toIncludeArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export const handleInclude: BlockDirectiveHandler = async (node, ctx) => {
  const args = node.args ?? {};
  const includePath = typeof args.path === "string" ? args.path : undefined;
  if (!includePath) {
    ctx.diagnostics.push(
      createError(
        DiagnosticCode.PARSE_ERROR,
        "@include requires path: \"...\"",
        node.loc,
      ),
    );
    return [];
  }

  if (!ctx.sourcePath) {
    ctx.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_NOT_FOUND,
        "@include requires sourcePath in evaluation options",
        node.loc,
      ),
    );
    return [];
  }

  if (!ctx.loadFile) {
    ctx.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_NOT_FOUND,
        "@include requires a file loader in evaluation options",
        node.loc,
      ),
    );
    return [];
  }

  const includeRoot = ctx.includeRoot ?? defaultIncludeRoot(ctx.sourcePath);
  const resolved = resolveIncludeFilePath({
    includePath,
    sourcePath: ctx.sourcePath,
    rootPath: includeRoot,
  });
  if (!resolved.ok) {
    ctx.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_NOT_FOUND,
        resolved.reason,
        node.loc,
      ),
    );
    return [];
  }

  const resolvedPath = resolved.path;
  if (ctx.includeStack.includes(resolvedPath)) {
    ctx.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_CYCLE,
        `Import cycle detected at '${resolvedPath}'`,
        node.loc,
      ),
    );
    return [];
  }

  let childSource: string;
  try {
    childSource = await ctx.loadFile(resolvedPath);
  } catch (cause) {
    ctx.diagnostics.push(
      createError(
        DiagnosticCode.IMPORT_NOT_FOUND,
        `Failed to load include '${resolvedPath}': ${cause instanceof Error ? cause.message : String(cause)}`,
        node.loc,
      ),
    );
    return [];
  }

  const parsed = parseSource(childSource);
  ctx.diagnostics.push(...parsed.diagnostics.map((diagnostic) => withDiagnosticSource(diagnostic, resolvedPath)));
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return [];
  }

  // This bind pass is only for local symbol collection in the included subtree.
  // Primary directive/ref validation ownership belongs to the top-level bind phase.
  const bindResult = bindSync(parsed.cst, {
    validateDirectives: false,
    validateRefs: false,
  });
  ctx.diagnostics.push(...bindResult.diagnostics.map((diagnostic) => withDiagnosticSource(diagnostic, resolvedPath)));
  if (bindResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return [];
  }

  const includeArgs = toIncludeArgs(args.args);
  const { names: requiredNames, types: typeContracts, diagnostics: paramsDiags } = readParamsContract(parsed.cst);
  ctx.diagnostics.push(...paramsDiags);
  const arityDiags = validateIncludeParams(requiredNames, includeArgs, node.loc);
  ctx.diagnostics.push(...arityDiags);
  if (arityDiags.length > 0) {
    return [];
  }

  const typeDiags = validateIncludeParamTypes(typeContracts, includeArgs, node.loc);
  ctx.diagnostics.push(...typeDiags);
  if (typeDiags.length > 0) {
    return [];
  }

  const childVariables = {
    ...ctx.variables,
    ...includeArgs,
  };

  const childResult = await ctx.evaluateSubdocument(parsed.cst, bindResult.symbols, {
    variables: childVariables,
    sourcePath: resolvedPath,
    includeRoot,
    loadFile: ctx.loadFile,
    includeStack: [...ctx.includeStack, resolvedPath],
  });
  ctx.diagnostics.push(...childResult.diagnostics);

  return childResult.document.blocks;
};
