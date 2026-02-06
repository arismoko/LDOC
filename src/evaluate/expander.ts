/**
 * Macro expansion: @use, @slot, @set
 */

import type { CSTNode, CSTDirective } from "../types/cst.ts";
import type { Block } from "../types/document-ir.ts";
import type { SymbolTable, MacroSymbol } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { DiagnosticCode, error } from "../types/diagnostics.ts";
import { cloneNodes } from "./utils.ts";
import type { EvaluatorContext, TransformFunction } from "./evaluator.ts";

/**
 * Process @use directive - expand macro.
 */
export function processUse(
  directive: CSTDirective,
  ctx: EvaluatorContext,
  transform: TransformFunction
): Block[] {
  // Check depth limit
  if (ctx.depth >= ctx.maxDepth) {
    ctx.diagnostics.push(
      error(
        DiagnosticCode.EXPRESSION_ERROR,
        `@use: expansion depth limit (${ctx.maxDepth}) exceeded`,
        directive.loc
      )
    );
    return [];
  }

  // Get macro name
  const macroName = extractMacroName(directive);
  if (!macroName) {
    ctx.diagnostics.push(
      error(DiagnosticCode.EXPRESSION_ERROR, "@use requires a macro name", directive.loc)
    );
    return [];
  }

  // Look up macro
  const macro = ctx.symbols.macros.get(macroName);
  if (!macro) {
    ctx.diagnostics.push(
      error(DiagnosticCode.EXPRESSION_ERROR, `@use: undefined macro '${macroName}'`, directive.loc)
    );
    return [];
  }

  // Bind arguments to parameters
  const boundArgs = bindArguments(directive, macro);

  // Clone macro body
  const clonedBody = cloneNodes(macro.body);

  // Create child context with parameters as locals
  const childLocals = { ...ctx.locals, ...boundArgs };

  // Store children for @slot
  if (directive.body && directive.body.length > 0) {
    (childLocals as Record<string, unknown>)["__children__"] = directive.body;
  }

  const childCtx: EvaluatorContext = {
    ...ctx,
    locals: childLocals,
    depth: ctx.depth + 1,
  };

  // Transform the cloned body
  const results: Block[] = [];
  for (const node of clonedBody) {
    results.push(...transform(node, childCtx));
  }

  return results;
}

/**
 * Process @slot directive - inject children from @use.
 */
export function processSlot(
  directive: CSTDirective,
  ctx: EvaluatorContext,
  transform: TransformFunction
): Block[] {
  const children = ctx.locals["__children__"] as CSTNode[] | undefined;
  if (!children || children.length === 0) {
    return [];
  }

  const results: Block[] = [];
  for (const node of children) {
    results.push(...transform(node, ctx));
  }
  return results;
}

/**
 * Process @set directive - update context variables.
 */
export function processSet(
  directive: CSTDirective,
  ctx: EvaluatorContext
): void {
  const args = directive.arguments;
  if (args.length === 0) return;

  const firstArg = args[0];
  if (!firstArg) return;

  let name: string | undefined;
  let value: unknown;

  if (firstArg.type === "NamedArg") {
    name = firstArg.name;
    value = extractValue(firstArg.value);
  } else if (firstArg.type === "PositionalArg" && firstArg.value.type === "Identifier") {
    name = firstArg.value.name;
    if (args.length > 1 && args[1]?.type === "PositionalArg") {
      value = extractValue(args[1].value);
    }
  }

  if (name) {
    ctx.globals[name] = value;
  }
}

// Helper to extract macro name from @use directive
function extractMacroName(directive: CSTDirective): string | undefined {
  const firstArg = directive.arguments[0];
  if (!firstArg) return undefined;

  if (firstArg.type === "PositionalArg") {
    if (firstArg.value.type === "Identifier") {
      return firstArg.value.name;
    }
    if (firstArg.value.type === "StringLiteral") {
      return firstArg.value.value;
    }
  }

  return undefined;
}

// Helper to bind arguments to macro parameters
function bindArguments(
  directive: CSTDirective,
  macro: MacroSymbol
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const args = directive.arguments.slice(1); // Skip macro name
  const params = macro.parameters;

  // First, apply default values
  for (const param of params) {
    if (param.defaultValue !== undefined) {
      result[param.name] = param.defaultValue;
    }
  }

  // Then, apply positional arguments
  let positionalIndex = 0;
  for (const arg of args) {
    if (arg.type === "PositionalArg") {
      const param = params[positionalIndex];
      if (param) {
        result[param.name] = extractValue(arg.value);
        positionalIndex++;
      }
    } else if (arg.type === "NamedArg") {
      result[arg.name] = extractValue(arg.value);
    }
  }

  return result;
}

// Helper to extract value from CST value node
function extractValue(value: { type: string }): unknown {
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "StringLiteral":
      return v.value;
    case "NumberLiteral":
      return v.value;
    case "BooleanLiteral":
      return v.value;
    case "Identifier":
      // Coerce boolean-like identifiers
      if (v.name === "true") return true;
      if (v.name === "false") return false;
      return v.name;
    case "Expression":
      return v.raw;
    default:
      return undefined;
  }
}
